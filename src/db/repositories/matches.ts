import type { EventKind, MatchStatus } from '../../providers/types.ts';
import { many, nowIso, one, run, type Db } from '../connection.ts';

export interface MatchInput {
  provider: string;
  externalId: string;
  stageId: number;
  groupId: number | null;
  round: number | null;
  roundLabel: string | null;
  roundSource: 'provider' | 'inferred' | 'manual' | null;
  homeTeamId: number;
  awayTeamId: number;
  kickoffUtc: string;
  status: MatchStatus;
  statusDetail: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homePens: number | null;
  awayPens: number | null;
  decidedBy: 'regular' | 'extra_time' | 'penalties' | null;
  winnerTeamId: number | null;
  venue: string | null;
  city: string | null;
  eventsComplete: boolean;
  contentHash: string;
}

export interface EventInput {
  kind: EventKind;
  minute: number | null;
  addedTime: number | null;
  minuteLabel: string;
  teamId: number;
  playerId: number | null;
}

export interface MatchRow {
  id: number;
  provider: string;
  external_id: string;
  stage_id: number;
  group_id: number | null;
  round: number | null;
  round_label: string | null;
  round_source: string | null;
  home_team_id: number;
  away_team_id: number;
  kickoff_utc: string;
  status: MatchStatus;
  status_detail: string | null;
  home_score: number | null;
  away_score: number | null;
  home_pens: number | null;
  away_pens: number | null;
  decided_by: string | null;
  winner_team_id: number | null;
  venue: string | null;
  city: string | null;
  events_complete: number;
  content_hash: string;
  first_seen_at: string;
  updated_at: string;
  finished_at: string | null;
}

export type UpsertOutcome = 'inserted' | 'updated' | 'unchanged';

export class MatchesRepo {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Inserta o actualiza; los eventos se reemplazan solo si el contenido cambió. */
  upsert(m: MatchInput, events: EventInput[]): { id: number; outcome: UpsertOutcome; becameFinished: boolean } {
    const existing = one<{ id: number; content_hash: string; status: string; round_source: string | null }>(
      this.#db,
      'SELECT id, content_hash, status, round_source FROM matches WHERE provider = :p AND external_id = :e',
      { p: m.provider, e: m.externalId },
    );
    const now = nowIso();
    const params = {
      provider: m.provider,
      ext: m.externalId,
      stage: m.stageId,
      grp: m.groupId,
      round: m.round,
      roundLabel: m.roundLabel,
      roundSource: m.roundSource,
      home: m.homeTeamId,
      away: m.awayTeamId,
      kickoff: m.kickoffUtc,
      status: m.status,
      detail: m.statusDetail,
      hs: m.homeScore,
      as: m.awayScore,
      hp: m.homePens,
      ap: m.awayPens,
      decided: m.decidedBy,
      winner: m.winnerTeamId,
      venue: m.venue,
      city: m.city,
      complete: m.eventsComplete ? 1 : 0,
      hash: m.contentHash,
      now,
      finishedAt: m.status === 'finished' ? now : null,
    };

    if (!existing) {
      const { lastId } = run(
        this.#db,
        `INSERT INTO matches (provider, external_id, stage_id, group_id, round, round_label, round_source,
           home_team_id, away_team_id, kickoff_utc, status, status_detail, home_score, away_score,
           home_pens, away_pens, decided_by, winner_team_id, venue, city, events_complete,
           content_hash, first_seen_at, updated_at, finished_at)
         VALUES (:provider, :ext, :stage, :grp, :round, :roundLabel, :roundSource, :home, :away, :kickoff,
           :status, :detail, :hs, :as, :hp, :ap, :decided, :winner, :venue, :city, :complete,
           :hash, :now, :now, :finishedAt)`,
        params,
      );
      this.#insertEvents(lastId, events);
      return { id: lastId, outcome: 'inserted', becameFinished: m.status === 'finished' };
    }

    if (existing.content_hash === m.contentHash) return { id: existing.id, outcome: 'unchanged', becameFinished: false };

    const becameFinished = existing.status !== 'finished' && m.status === 'finished';
    run(
      this.#db,
      `UPDATE matches SET stage_id = :stage, group_id = :grp, round_label = :roundLabel,
         round = CASE WHEN round_source = 'manual' THEN round ELSE COALESCE(:round, round) END,
         round_source = CASE WHEN round_source = 'manual' THEN round_source ELSE COALESCE(:roundSource, round_source) END,
         home_team_id = :home, away_team_id = :away, kickoff_utc = :kickoff, status = :status,
         status_detail = :detail, home_score = :hs, away_score = :as, home_pens = :hp, away_pens = :ap,
         decided_by = :decided, winner_team_id = :winner, venue = :venue, city = :city,
         events_complete = :complete, content_hash = :hash, updated_at = :now,
         finished_at = CASE WHEN :status = 'finished' THEN COALESCE(finished_at, :now) ELSE NULL END
       WHERE id = :id`,
      { ...params, id: existing.id },
    );
    run(this.#db, 'DELETE FROM match_events WHERE match_id = :id', { id: existing.id });
    this.#insertEvents(existing.id, events);
    return { id: existing.id, outcome: 'updated', becameFinished };
  }

  setRound(matchId: number, round: number | null, source: 'inferred' | 'manual'): void {
    run(this.#db, 'UPDATE matches SET round = :r, round_source = :s WHERE id = :id', { r: round, s: source, id: matchId });
  }

  forStage(stageId: number): MatchRow[] {
    return many<MatchRow>(this.#db, 'SELECT * FROM matches WHERE stage_id = :s ORDER BY kickoff_utc, id', { s: stageId });
  }

  roundOverrides(stageId: number): Map<number, number> {
    const rows = many<{ match_id: number; round: number }>(
      this.#db,
      'SELECT o.match_id, o.round FROM round_overrides o JOIN matches m ON m.id = o.match_id WHERE m.stage_id = :s',
      { s: stageId },
    );
    return new Map(rows.map((r) => [r.match_id, r.round]));
  }

  #insertEvents(matchId: number, events: EventInput[]): void {
    events.forEach((e, seq) => {
      run(
        this.#db,
        `INSERT INTO match_events (match_id, seq, kind, minute, added_time, minute_label, team_id, player_id)
         VALUES (:m, :seq, :kind, :min, :add, :label, :team, :player)`,
        { m: matchId, seq, kind: e.kind, min: e.minute, add: e.addedTime, label: e.minuteLabel, team: e.teamId, player: e.playerId },
      );
    });
  }
}
