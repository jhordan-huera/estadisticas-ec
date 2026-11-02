// Carga desde SQLite el modelo plano que consume el motor de estadísticas.

import { AppError } from '../core/errors.ts';
import { many, type Db } from '../db/connection.ts';
import { CompetitionsRepo } from '../db/repositories/competitions.ts';
import type { EventKind, MatchStatus, StageKind } from '../providers/types.ts';
import type { SeasonData, StatPlayer, StatTeam } from './types.ts';

export function loadSeason(db: Db, competitionCode: string, year: number): SeasonData {
  const comps = new CompetitionsRepo(db);
  const season = comps.findSeason(competitionCode, year);
  if (!season) throw new AppError('SEASON_NOT_FOUND', `No hay datos de ${competitionCode} ${year}; ejecuta "sincronizar" primero`);

  const stages = comps.stages(season.seasonId).map((s) => ({ id: s.id, name: s.name, kind: s.kind as StageKind, order: s.ord }));
  const groups = stages.flatMap((s) =>
    comps.groups(s.id).map((g) => ({ id: g.id, stageId: s.id, name: g.name, teamIds: comps.groupTeams(g.id) })),
  );

  const matchRows = many<{
    id: number;
    stage_id: number;
    group_id: number | null;
    round: number | null;
    round_label: string | null;
    kickoff_utc: string;
    status: MatchStatus;
    home_team_id: number;
    away_team_id: number;
    home_score: number | null;
    away_score: number | null;
    venue: string | null;
    city: string | null;
    events_complete: number;
  }>(
    db,
    `SELECT m.id, m.stage_id, m.group_id, m.round, m.round_label, m.kickoff_utc, m.status, m.home_team_id,
            m.away_team_id, m.home_score, m.away_score, m.venue, m.city, m.events_complete
     FROM matches m JOIN stages s ON s.id = m.stage_id WHERE s.season_id = :season ORDER BY m.kickoff_utc, m.id`,
    { season: season.seasonId },
  );
  const matches = matchRows.map((r) => ({
    id: r.id,
    stageId: r.stage_id,
    groupId: r.group_id,
    round: r.round,
    roundLabel: r.round_label,
    kickoffUtc: r.kickoff_utc,
    status: r.status,
    homeTeamId: r.home_team_id,
    awayTeamId: r.away_team_id,
    homeScore: r.home_score,
    awayScore: r.away_score,
    venue: r.venue,
    city: r.city,
    eventsComplete: r.events_complete === 1,
  }));

  const events = many<{ match_id: number; seq: number; kind: EventKind; minute: number | null; added_time: number | null; minute_label: string; team_id: number; player_id: number | null }>(
    db,
    `SELECT e.match_id, e.seq, e.kind, e.minute, e.added_time, e.minute_label, e.team_id, e.player_id
     FROM match_events e JOIN matches m ON m.id = e.match_id JOIN stages s ON s.id = m.stage_id
     WHERE s.season_id = :season ORDER BY e.match_id, e.seq`,
    { season: season.seasonId },
  ).map((e) => ({ matchId: e.match_id, seq: e.seq, kind: e.kind, minute: e.minute, addedTime: e.added_time, minuteLabel: e.minute_label, teamId: e.team_id, playerId: e.player_id }));

  const teams = new Map<number, StatTeam>(
    many<{ id: number; name: string; short_name: string; abbr: string; color: string | null; text_color: string | null }>(
      db,
      'SELECT id, name, short_name, abbr, color, text_color FROM teams',
    ).map((t) => [t.id, { id: t.id, name: t.name, shortName: t.short_name, abbr: t.abbr, color: t.color, textColor: t.text_color }]),
  );
  const players = new Map<number, StatPlayer>(
    many<{ id: number; name: string; short_name: string; team_id: number | null }>(db, 'SELECT id, name, short_name, team_id FROM players').map((p) => [
      p.id,
      { id: p.id, name: p.name, shortName: p.short_name, teamId: p.team_id },
    ]),
  );
  const adjustments = many<{ team_id: number; points: number; reason: string; effective_from: string }>(
    db,
    'SELECT team_id, points, reason, effective_from FROM point_adjustments WHERE season_id = :s',
    { s: season.seasonId },
  ).map((a) => ({ teamId: a.team_id, points: a.points, reason: a.reason, effectiveFrom: a.effective_from }));

  return { competitionCode, competitionName: season.competitionName, year, stages, groups, teams, players, matches, events, adjustments };
}
