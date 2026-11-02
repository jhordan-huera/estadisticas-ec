import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PostKind } from '../../src/core/config.ts';
import { standingsView } from '../../src/content/views.ts';
import { planCandidates } from '../../src/scheduler/planner.ts';
import { A, B, C, D, ctxFor, match, season } from '../helpers.ts';

const ALL: PostKind[] = ['cartelera', 'resultado', 'resumen', 'tabla', 'goleadores', 'equipo', 'duelo'];
const config = { ventanaDias: 3, anticipacionCarteleraHoras: 72, anticipacionPreviaHoras: 24 };

// Fecha 1: sábado 7 y domingo 8 de marzo (hora de Ecuador = UTC-5). Fecha 2: sábado 14.
function scenario() {
  return season([
    match(A, B, [2, 0], '2026-03-07T20:00:00Z', { round: 1, id: 1 }),
    match(C, D, [1, 1], '2026-03-08T20:00:00Z', { round: 1, id: 2 }),
    match(B, C, null, '2026-03-14T20:00:00Z', { round: 2, id: 3 }),
    match(D, A, null, '2026-03-14T23:00:00Z', { round: 2, id: 4 }),
  ]);
}

function plan(now: string, opts: { snapshots?: Map<string, string>; kinds?: PostKind[]; data?: ReturnType<typeof season> } = {}) {
  return planCandidates({
    ctx: ctxFor(opts.data ?? scenario()),
    now: new Date(now),
    kinds: new Set(opts.kinds ?? ALL),
    config,
    snapshots: opts.snapshots ?? new Map(),
  });
}

const keys = (cs: { dedupeKey: string }[]) => cs.map((c) => c.dedupeKey).sort();

describe('planificador', () => {
  it('tras completarse la fecha encola resultados, resumen y tabla', () => {
    const cs = plan('2026-03-09T03:00:00Z'); // domingo 8, 22:00 en Ecuador
    const kinds = new Set(cs.map((c) => c.kind));
    assert.ok(kinds.has('resultado') && kinds.has('resumen') && kinds.has('tabla'));
    assert.deepEqual(keys(cs.filter((c) => c.kind === 'resultado')), ['resultado:prueba:1', 'resultado:prueba:2']);
    assert.equal(cs.find((c) => c.kind === 'resumen')?.dedupeKey, 'resumen:prueba:1:1');
  });

  it('respeta las prioridades: resultado antes que tabla, y equipo al final', () => {
    const cs = plan('2026-03-09T03:00:00Z');
    const p = (k: PostKind) => cs.find((c) => c.kind === k)?.priority ?? Infinity;
    assert.ok(p('resultado') < p('resumen'));
    assert.ok(p('resumen') < p('tabla'));
  });

  it('no publica contenido viejo fuera de la ventana de días', () => {
    const cs = plan('2026-03-13T12:00:00Z', { kinds: ['resultado', 'resumen'] });
    assert.equal(cs.length, 0);
  });

  it('no repite la tabla si su huella coincide con la última publicada', () => {
    const data = scenario();
    const fp = standingsView(ctxFor(data)).fingerprint;
    const cs = plan('2026-03-09T03:00:00Z', { data, snapshots: new Map([['tabla:prueba:2026', fp]]), kinds: ['tabla'] });
    assert.equal(cs.length, 0);
  });

  it('espera a que terminen los partidos del día antes de publicar la tabla', () => {
    // Domingo 8, 12:00 en Ecuador: A-B ya se jugó, pero C-D empieza a las 15:00.
    const data = season([
      match(A, B, [2, 0], '2026-03-07T20:00:00Z', { round: 1 }),
      match(C, D, null, '2026-03-08T20:00:00Z', { round: 1 }),
    ]);
    assert.equal(plan('2026-03-08T17:00:00Z', { data, kinds: ['tabla'] }).length, 0);
    // A las 23:00 (ya sin partidos pendientes ese día) sí se publica.
    data.matches[1] = { ...data.matches[1]!, status: 'finished', homeScore: 1, awayScore: 0 };
    assert.equal(plan('2026-03-09T04:00:00Z', { data, kinds: ['tabla'] }).length, 1);
  });

  it('no publica la tabla con un partido en juego', () => {
    const data = scenario();
    data.matches[1] = { ...data.matches[1]!, status: 'live' };
    assert.equal(plan('2026-03-09T03:00:00Z', { data, kinds: ['tabla'] }).length, 0);
  });

  it('encola la cartelera dentro de las 72 h previas al inicio de la fecha', () => {
    assert.equal(plan('2026-03-10T12:00:00Z', { kinds: ['cartelera'] }).length, 0); // faltan 104 h
    const cs = plan('2026-03-12T12:00:00Z', { kinds: ['cartelera'] }); // faltan 56 h
    assert.equal(cs[0]?.dedupeKey, 'cartelera:prueba:1:2');
    assert.equal(cs[0]?.expiresAt, '2026-03-14T20:00:00Z');
  });

  it('encola previas solo para partidos de las próximas 24 h y vencen al empezar', () => {
    const cs = plan('2026-03-14T01:00:00Z', { kinds: ['duelo'] });
    assert.deepEqual(keys(cs), ['duelo:prueba:3', 'duelo:prueba:4']);
    assert.equal(cs.find((c) => c.dedupeKey === 'duelo:prueba:3')?.expiresAt, '2026-03-14T20:00:00Z');
  });

  it('elige para la radiografía al equipo con la racha más notable', () => {
    const data = season([
      match(A, B, [1, 0], '2026-03-01T20:00:00Z', { round: 1 }),
      match(C, D, [0, 0], '2026-03-01T20:00:00Z', { round: 1 }),
      match(A, C, [2, 0], '2026-03-04T20:00:00Z', { round: 2 }),
      match(B, D, [0, 1], '2026-03-04T20:00:00Z', { round: 2 }),
      match(D, A, [0, 3], '2026-03-07T20:00:00Z', { round: 3 }),
      match(B, C, [1, 1], '2026-03-07T20:00:00Z', { round: 3 }),
    ]);
    const cs = plan('2026-03-08T12:00:00Z', { data, kinds: ['equipo'] });
    assert.deepEqual(cs[0]?.subject, { stageId: 1, round: 3, teamId: A.id });
  });

  it('con fecha de arranque no publica partidos anteriores aunque estén dentro de la ventana', () => {
    const cs = planCandidates({
      ctx: ctxFor(scenario()),
      now: new Date('2026-03-09T03:00:00Z'),
      kinds: new Set(['resultado', 'resumen']),
      config: { ...config, desde: '2026-03-08T00:00:00-05:00' },
      snapshots: new Map(),
    });
    // A-B (sábado 7) queda fuera; C-D (domingo 8) y el resumen de la fecha (que termina el 8) entran.
    assert.deepEqual(keys(cs), ['resultado:prueba:2', 'resumen:prueba:1:1']);
  });

  it('escalona las previas de partidos que coinciden (45 min entre una y otra)', () => {
    // Cuatro partidos el domingo 15 a las 15:00 de Ecuador (20:00Z): sus previas, el sábado desde las 15:00.
    const data = season([
      match(A, B, null, '2026-03-15T20:00:00Z', { id: 11 }),
      match(C, D, null, '2026-03-15T20:00:00Z', { id: 12 }),
      match(B, C, null, '2026-03-15T20:00:00Z', { id: 13 }),
      match(D, A, null, '2026-03-15T20:00:00Z', { id: 14 }),
    ]);
    const cs = plan('2026-03-14T20:00:00Z', { data, kinds: ['duelo'] });
    assert.deepEqual(
      cs.map((c) => c.scheduledFor),
      ['2026-03-14T20:00:00Z', '2026-03-14T20:45:00Z', '2026-03-14T21:30:00Z', '2026-03-14T22:15:00Z'],
    );
  });

  it('no publica de madrugada: lo que cae fuera de 08:00–23:00 espera a las 08:00 (salvo resultados)', () => {
    // Domingo 8 a las 23:30 de Ecuador (04:30Z del lunes): la tabla pasa al lunes 08:00 (13:00Z).
    const data = season([match(A, B, [2, 0], '2026-03-09T03:00:00Z', { round: 1 }), match(C, D, [1, 1], '2026-03-09T03:00:00Z', { round: 1 })]);
    const cs = plan('2026-03-09T04:30:00Z', { data, kinds: ['tabla', 'resultado'] });
    assert.equal(cs.find((c) => c.kind === 'tabla')?.scheduledFor, '2026-03-09T13:00:00Z');
    assert.ok(cs.filter((c) => c.kind === 'resultado').every((c) => c.scheduledFor === '2026-03-09T04:30:00Z'));
  });

  it('solo produce los tipos habilitados para la competición', () => {
    const cs = plan('2026-03-09T03:00:00Z', { kinds: ['resultado'] });
    assert.ok(cs.every((c) => c.kind === 'resultado'));
  });
});
