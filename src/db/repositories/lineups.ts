import { many, nowIso, run, type Db } from '../connection.ts';

export interface LineupPlayerInput {
  playerId: number;
  name: string;
  jersey: string | null;
  position: string | null;
  formationPlace: number | null;
  starter: boolean;
}

/** Un equipo con menos de 11 titulares no tiene la alineación confirmada. */
export const STARTERS = 11;

export class LineupsRepo {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Reemplaza la alineación del equipo en el partido. */
  save(matchId: number, teamId: number, formation: string | null, players: LineupPlayerInput[]): void {
    run(this.#db, 'DELETE FROM lineup_players WHERE match_id = :m AND team_id = :t', { m: matchId, t: teamId });
    run(
      this.#db,
      `INSERT INTO match_lineups (match_id, team_id, formation, fetched_at) VALUES (:m, :t, :f, :now)
       ON CONFLICT(match_id, team_id) DO UPDATE SET formation = excluded.formation, fetched_at = excluded.fetched_at`,
      { m: matchId, t: teamId, f: formation, now: nowIso() },
    );
    for (const p of players) {
      run(
        this.#db,
        `INSERT OR REPLACE INTO lineup_players (match_id, team_id, player_id, name, jersey, position, formation_place, starter)
         VALUES (:m, :t, :p, :n, :j, :pos, :fp, :s)`,
        { m: matchId, t: teamId, p: p.playerId, n: p.name, j: p.jersey, pos: p.position, fp: p.formationPlace, s: p.starter ? 1 : 0 },
      );
    }
  }

  /** Partidos (de la lista) que ya tienen las dos alineaciones completas. */
  completeMatches(matchIds: number[]): Set<number> {
    if (matchIds.length === 0) return new Set();
    const rows = many<{ match_id: number }>(
      this.#db,
      `SELECT match_id FROM (
         SELECT match_id, team_id, SUM(starter) AS titulares FROM lineup_players
         WHERE match_id IN (${matchIds.map(Number).join(',')}) GROUP BY match_id, team_id
       ) WHERE titulares >= ${STARTERS} GROUP BY match_id HAVING COUNT(*) = 2`,
    );
    return new Set(rows.map((r) => r.match_id));
  }
}
