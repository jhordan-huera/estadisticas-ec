import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nullLogger } from '../../src/core/logger.ts';
import { one, openDatabase, run } from '../../src/db/connection.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MatchesRepo, type MatchInput } from '../../src/db/repositories/matches.ts';

describe('partidos guardados', () => {
  it('actualiza un partido que cambia de estado (programado → en juego → finalizado)', () => {
    const db = openDatabase(':memory:');
    migrate(db, nullLogger);
    const t = '2026-11-01T00:00:00Z';
    db.exec(`INSERT INTO competitions (id, code, name, kind) VALUES (1, 'serie-a', 'Serie A', 'liga');
      INSERT INTO seasons (id, competition_id, year) VALUES (1, 1, 2026);
      INSERT INTO stages (id, season_id, external_id, name, kind, ord) VALUES (1, 1, '1', 'Fase final', 'league', 1);`);
    for (const id of [1, 2]) run(db, `INSERT INTO teams (id, name, short_name, abbr, created_at, updated_at) VALUES (:id, 'E', 'E', 'E', :t, :t)`, { id, t });

    const repo = new MatchesRepo(db);
    const base: MatchInput = {
      provider: 'espn', externalId: '401921373', stageId: 1, groupId: null, round: null, roundLabel: null, roundSource: null,
      homeTeamId: 1, awayTeamId: 2, kickoffUtc: '2026-11-02T20:30:00Z', status: 'scheduled', statusDetail: null,
      homeScore: null, awayScore: null, homePens: null, awayPens: null, decidedBy: null, winnerTeamId: null,
      venue: null, city: null, eventsComplete: true, contentHash: 'v1',
    };
    const { id } = repo.upsert(base, []);
    assert.equal(repo.upsert({ ...base, status: 'live', homeScore: 0, awayScore: 0, contentHash: 'v2' }, []).outcome, 'updated');
    const done = repo.upsert({ ...base, status: 'finished', homeScore: 2, awayScore: 1, contentHash: 'v3' }, []);
    assert.deepEqual([done.outcome, done.becameFinished], ['updated', true]);
    const row = one<{ status: string; home_score: number; finished_at: string | null }>(db, 'SELECT status, home_score, finished_at FROM matches WHERE id = :id', { id });
    assert.equal(row?.status, 'finished');
    assert.equal(row?.home_score, 2);
    assert.ok(row?.finished_at);
  });
});
