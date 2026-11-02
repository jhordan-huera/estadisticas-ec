import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { AppContext } from '../../src/app.ts';
import { nullLogger } from '../../src/core/logger.ts';
import { openDatabase, run, type Db } from '../../src/db/connection.ts';
import { migrate } from '../../src/db/migrate.ts';
import { lineupWatchNotices } from '../../src/notify/lineup-watch.ts';
import type { Notice, Notifier } from '../../src/notify/notifier.ts';

// Partido Orense vs Técnico U. a las 20:30Z (15:30 en Ecuador); se busca desde 2 h antes.
const KICKOFF = '2026-11-02T20:30:00Z';

function seed(db: Db): void {
  const t = '2026-11-01T00:00:00Z';
  db.exec(`INSERT INTO competitions (id, code, name, kind) VALUES (1, 'serie-a', 'Serie A', 'liga');
    INSERT INTO seasons (id, competition_id, year) VALUES (1, 1, 2026);
    INSERT INTO stages (id, season_id, external_id, name, kind, ord) VALUES (1, 1, '1', 'Fase final', 'league', 1);`);
  for (const [id, name] of [[1, 'Orense'], [2, 'Técnico U.']] as const) {
    run(db, `INSERT INTO teams (id, name, short_name, abbr, created_at, updated_at) VALUES (:id, :n, :n, :n, :t, :t)`, { id, n: name, t });
  }
  run(
    db,
    `INSERT INTO matches (id, provider, external_id, stage_id, home_team_id, away_team_id, kickoff_utc, status, content_hash, first_seen_at, updated_at)
     VALUES (10, 'espn', '401921373', 1, 1, 2, :k, 'scheduled', 'x', :t, :t)`,
    { k: KICKOFF, t },
  );
}

function appWith(db: Db): AppContext {
  const file = { temporada: 2026, zonaHoraria: 'America/Guayaquil', publicacion: { alineacionesHorasAntes: 2, competiciones: { 'serie-a': ['alineaciones'] } } };
  return { db, logger: nullLogger, config: { file } } as unknown as AppContext;
}

describe('avisos del seguimiento de alineaciones', () => {
  let db: Db;
  let sent: Notice[];
  const notifier: Notifier = { name: 'prueba', send: async (n) => void sent.push(n) };

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db, nullLogger);
    seed(db);
    sent = [];
  });

  it('avisa una sola vez cuando empieza la búsqueda y otra si las alineaciones nunca salen', async () => {
    const app = appWith(db);
    assert.equal(await lineupWatchNotices(app, new Date('2026-11-02T18:00:00Z'), [notifier]), 0); // aún fuera de la ventana
    assert.equal(await lineupWatchNotices(app, new Date('2026-11-02T18:35:00Z'), [notifier]), 1);
    assert.equal(await lineupWatchNotices(app, new Date('2026-11-02T19:00:00Z'), [notifier]), 0);
    assert.equal(sent[0]?.title, 'Buscando alineaciones: Orense vs Técnico U.');
    assert.match(sent[0]!.message, /15:30/);

    assert.equal(await lineupWatchNotices(app, new Date('2026-11-02T21:20:00Z'), [notifier]), 1);
    assert.equal(await lineupWatchNotices(app, new Date('2026-11-02T21:30:00Z'), [notifier]), 0);
    assert.equal(sent[1]?.title, 'Sin alineaciones: Orense vs Técnico U.');
  });

  it('si salieron a tiempo, cierra el seguimiento sin otro aviso', async () => {
    const app = appWith(db);
    await lineupWatchNotices(app, new Date('2026-11-02T18:35:00Z'), [notifier]);
    for (const team of [1, 2]) {
      for (let i = 0; i < 11; i++) {
        run(db, `INSERT INTO players (id, name, short_name, team_id, created_at, updated_at) VALUES (:id, 'J', 'J', :team, 'x', 'x')`, { id: team * 100 + i, team });
        run(db, `INSERT INTO lineup_players (match_id, team_id, player_id, name, starter) VALUES (10, :team, :id, 'J', 1)`, { id: team * 100 + i, team });
      }
    }
    assert.equal(await lineupWatchNotices(app, new Date('2026-11-02T21:20:00Z'), [notifier]), 0);
    assert.equal(sent.length, 1);
  });

  it('si ningún canal recibió el aviso, lo reintenta en la siguiente ejecución', async () => {
    const app = appWith(db);
    const broken: Notifier = { name: 'roto', send: async () => Promise.reject(new Error('sin red')) };
    assert.equal(await lineupWatchNotices(app, new Date('2026-11-02T18:35:00Z'), [broken]), 0);
    assert.equal(await lineupWatchNotices(app, new Date('2026-11-02T18:40:00Z'), [notifier]), 1);
  });
});
