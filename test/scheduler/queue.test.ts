import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { nullLogger } from '../../src/core/logger.ts';
import { openDatabase, type Db } from '../../src/db/connection.ts';
import { migrate } from '../../src/db/migrate.ts';
import type { Candidate } from '../../src/scheduler/planner.ts';
import type { AppContext } from '../../src/app.ts';
import { skipIfDisabled } from '../../src/scheduler/pipeline.ts';
import { MAX_ATTEMPTS, PostQueue } from '../../src/scheduler/queue.ts';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    kind: 'resultado',
    dedupeKey: 'resultado:prueba:1',
    competitionCode: 'prueba',
    season: 2026,
    subject: { matchId: 1 },
    priority: 10,
    scheduledFor: '2026-03-09T00:00:00Z',
    expiresAt: '2026-03-12T00:00:00Z',
    reason: 'prueba',
    ...overrides,
  };
}

describe('cola de publicaciones', () => {
  let db: Db;
  let queue: PostQueue;
  const render = (id: number) => queue.markRendered(id, { caption: 'texto', altText: 'alt', situation: 's', media: [] });

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db, nullLogger);
    queue = new PostQueue(db);
  });

  it('es idempotente: la misma clave no se encola dos veces', () => {
    assert.equal(queue.enqueue(candidate()).inserted, true);
    assert.equal(queue.enqueue(candidate()).inserted, false);
    assert.equal(queue.toRender('2026-03-10T00:00:00Z').length, 1);
  });

  it('una nueva versión de una serie reemplaza a la pendiente', () => {
    queue.enqueue(candidate({ kind: 'tabla', dedupeKey: 'tabla:v1', series: 'tabla:prueba', fingerprint: 'v1' }));
    const res = queue.enqueue(candidate({ kind: 'tabla', dedupeKey: 'tabla:v2', series: 'tabla:prueba', fingerprint: 'v2' }));
    assert.equal(res.superseded, 1);
    const pending = queue.toRender('2026-03-10T00:00:00Z');
    assert.deepEqual(pending.map((p) => p.dedupe_key), ['tabla:v2']);
  });

  it('acepta las alineaciones como tipo de publicación', () => {
    assert.equal(queue.enqueue(candidate({ kind: 'alineaciones', dedupeKey: 'alineaciones:prueba:1', priority: 12 })).inserted, true);
    assert.deepEqual(queue.toRender('2026-03-10T00:00:00Z').map((p) => p.kind), ['alineaciones']);
  });

  it('descarta lo encolado de una competición que ya no se publica (p. ej. las copas)', () => {
    queue.enqueue(candidate({ competitionCode: 'copa-ecuador', dedupeKey: 'resultado:copa-ecuador:1' }));
    queue.enqueue(candidate({ competitionCode: 'serie-a', dedupeKey: 'resultado:serie-a:2' }));
    const app = { config: { file: { publicacion: { competiciones: { 'serie-a': ['resultado'] } } } }, logger: nullLogger } as unknown as AppContext;
    const kept = queue.toRender('2026-03-10T00:00:00Z').filter((p) => !skipIfDisabled(app, queue, p));
    assert.deepEqual(kept.map((p) => p.dedupe_key), ['resultado:serie-a:2']);
    assert.deepEqual(queue.toRender('2026-03-10T00:00:00Z').map((p) => p.dedupe_key), ['resultado:serie-a:2']);
  });

  it('vence lo que ya no tiene sentido publicar', () => {
    queue.enqueue(candidate({ kind: 'duelo', dedupeKey: 'duelo:1', expiresAt: '2026-03-09T20:00:00Z' }));
    assert.equal(queue.expire('2026-03-09T21:00:00Z'), 1);
    assert.equal(queue.toRender('2026-03-09T21:00:00Z').length, 0);
  });

  it('elige por prioridad y respeta el límite', () => {
    queue.enqueue(candidate({ kind: 'equipo', dedupeKey: 'equipo:1', priority: 60 }));
    queue.enqueue(candidate({ kind: 'tabla', dedupeKey: 'tabla:1', priority: 30 }));
    queue.enqueue(candidate({ dedupeKey: 'resultado:1', priority: 10 }));
    for (const p of queue.toRender('2026-03-10T00:00:00Z')) render(p.id);
    const due = queue.dueForPublishing('2026-03-10T00:00:00Z', 2);
    assert.deepEqual(due.map((p) => p.dedupe_key), ['resultado:1', 'tabla:1']);
    assert.equal(queue.dueForPublishing('2026-03-10T00:00:00Z', 0).length, 0);
  });

  it('cuenta lo publicado en el día local de Ecuador', () => {
    queue.enqueue(candidate());
    const [p] = queue.toRender('2026-03-10T00:00:00Z');
    render(p!.id);
    queue.markPublished(p!.id, { mode: 'dry-run', externalId: 'x' });
    const today = new Date().toISOString();
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date(today));
    assert.equal(queue.publishedOn(local, 'America/Guayaquil', 'dry-run'), 1);
  });

  it('al publicar una serie guarda su huella para no repetirla', () => {
    queue.enqueue(candidate({ kind: 'tabla', dedupeKey: 'tabla:v1', series: 'tabla:prueba', fingerprint: 'v1' }));
    const [p] = queue.toRender('2026-03-10T00:00:00Z');
    render(p!.id);
    queue.markPublished(p!.id, { mode: 'dry-run', externalId: 'x' });
    assert.equal(queue.snapshots().get('tabla:prueba'), 'v1');
  });

  it('lo publicado en simulación sigue disponible para publicar de verdad', () => {
    queue.enqueue(candidate());
    const [p] = queue.toRender('2026-03-10T00:00:00Z');
    render(p!.id);
    queue.markPublished(p!.id, { mode: 'dry-run', externalId: 'dry-run-1' });
    assert.equal(queue.dueForPublishing('2026-03-10T00:00:00Z', 5, 'dry-run').length, 0);
    assert.equal(queue.dueForPublishing('2026-03-10T00:00:00Z', 5, 'instagram').length, 1);
    queue.markPublished(p!.id, { mode: 'instagram', externalId: 'M1' });
    assert.equal(queue.dueForPublishing('2026-03-10T00:00:00Z', 5, 'instagram').length, 0);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date());
    assert.equal(queue.publishedOn(local, 'America/Guayaquil', 'instagram'), 1);
    assert.equal(queue.publishedOn(local, 'America/Guayaquil', 'dry-run'), 0);
  });

  it('reintenta fallos temporales hasta el máximo y luego los deja como fallidos', () => {
    queue.enqueue(candidate());
    const [p] = queue.toRender('2026-03-10T00:00:00Z');
    render(p!.id);
    for (let i = 1; i < MAX_ATTEMPTS; i++) assert.equal(queue.markFailed(p!.id, 'red caída', true, 'publish'), 'rendered');
    assert.equal(queue.markFailed(p!.id, 'red caída', true, 'publish'), 'failed');
  });

  it('un fallo definitivo no se reintenta', () => {
    queue.enqueue(candidate());
    const [p] = queue.toRender('2026-03-10T00:00:00Z');
    render(p!.id);
    assert.equal(queue.markFailed(p!.id, 'estado incierto', false, 'publish'), 'failed');
  });
});
