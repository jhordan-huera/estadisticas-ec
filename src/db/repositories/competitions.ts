import type { ProviderGroup, ProviderStage, StageKind } from '../../providers/types.ts';
import { many, one, run, type Db } from '../connection.ts';

export interface StageRow {
  id: number;
  season_id: number;
  external_id: string;
  name: string;
  kind: StageKind;
  ord: number;
  starts_at: string | null;
  ends_at: string | null;
}

export interface GroupRow {
  id: number;
  stage_id: number;
  external_id: string;
  name: string;
}

export interface SeasonRef {
  competitionId: number;
  competitionCode: string;
  competitionName: string;
  seasonId: number;
  year: number;
}

export class CompetitionsRepo {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  ensureSeason(code: string, name: string, kind: 'liga' | 'copa', year: number): SeasonRef {
    run(
      this.#db,
      `INSERT INTO competitions (code, name, kind) VALUES (:code, :name, :kind)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, kind = excluded.kind`,
      { code, name, kind },
    );
    const comp = one<{ id: number }>(this.#db, 'SELECT id FROM competitions WHERE code = :code', { code })!;
    run(this.#db, 'INSERT INTO seasons (competition_id, year) VALUES (:c, :y) ON CONFLICT DO NOTHING', { c: comp.id, y: year });
    const season = one<{ id: number }>(this.#db, 'SELECT id FROM seasons WHERE competition_id = :c AND year = :y', { c: comp.id, y: year })!;
    return { competitionId: comp.id, competitionCode: code, competitionName: name, seasonId: season.id, year };
  }

  findSeason(code: string, year: number): SeasonRef | undefined {
    const row = one<{ cid: number; code: string; name: string; sid: number; year: number }>(
      this.#db,
      `SELECT c.id AS cid, c.code, c.name, s.id AS sid, s.year FROM competitions c
       JOIN seasons s ON s.competition_id = c.id WHERE c.code = :code AND s.year = :year`,
      { code, year },
    );
    return row && { competitionId: row.cid, competitionCode: row.code, competitionName: row.name, seasonId: row.sid, year: row.year };
  }

  upsertStage(seasonId: number, stage: ProviderStage): number {
    run(
      this.#db,
      `INSERT INTO stages (season_id, external_id, name, kind, ord, starts_at, ends_at)
       VALUES (:season, :ext, :name, :kind, :ord, :starts, :ends)
       ON CONFLICT(season_id, external_id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
         ord = excluded.ord, starts_at = excluded.starts_at, ends_at = excluded.ends_at`,
      {
        season: seasonId,
        ext: stage.externalId,
        name: stage.name,
        kind: stage.kind,
        ord: stage.order,
        starts: stage.startsAt ?? null,
        ends: stage.endsAt ?? null,
      },
    );
    return one<{ id: number }>(this.#db, 'SELECT id FROM stages WHERE season_id = :s AND external_id = :e', { s: seasonId, e: stage.externalId })!.id;
  }

  upsertGroup(stageId: number, group: ProviderGroup, teamIds: number[]): number {
    run(
      this.#db,
      `INSERT INTO stage_groups (stage_id, external_id, name) VALUES (:stage, :ext, :name)
       ON CONFLICT(stage_id, external_id) DO UPDATE SET name = excluded.name`,
      { stage: stageId, ext: group.externalId, name: group.name },
    );
    const id = one<{ id: number }>(this.#db, 'SELECT id FROM stage_groups WHERE stage_id = :s AND external_id = :e', { s: stageId, e: group.externalId })!.id;
    run(this.#db, 'DELETE FROM group_teams WHERE group_id = :g', { g: id });
    for (const teamId of teamIds) run(this.#db, 'INSERT INTO group_teams (group_id, team_id) VALUES (:g, :t)', { g: id, t: teamId });
    return id;
  }

  stages(seasonId: number): StageRow[] {
    return many<StageRow>(this.#db, 'SELECT * FROM stages WHERE season_id = :s ORDER BY ord', { s: seasonId });
  }

  groups(stageId: number): GroupRow[] {
    return many<GroupRow>(this.#db, 'SELECT * FROM stage_groups WHERE stage_id = :s ORDER BY external_id', { s: stageId });
  }

  groupTeams(groupId: number): number[] {
    return many<{ team_id: number }>(this.#db, 'SELECT team_id FROM group_teams WHERE group_id = :g', { g: groupId }).map((r) => r.team_id);
  }
}
