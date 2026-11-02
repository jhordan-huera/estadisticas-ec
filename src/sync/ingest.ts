// Ingesta: guarda una foto de temporada del proveedor en la base de datos, en una
// sola transacción, y aplica las comprobaciones de integridad independientes de la fuente.
// Nada se descarta en silencio: todo lo anómalo termina en data_issues.

import type { CompetitionConfig, TeamOverride } from '../core/config.ts';
import type { Logger } from '../core/logger.ts';
import { sha256, stableStringify } from '../core/text.ts';
import { many, nowIso, run, transaction, type Db } from '../db/connection.ts';
import { CompetitionsRepo } from '../db/repositories/competitions.ts';
import { IssuesRepo } from '../db/repositories/issues.ts';
import { MatchesRepo, type EventInput } from '../db/repositories/matches.ts';
import { TeamsRepo } from '../db/repositories/teams.ts';
import type { ProviderIssue, ProviderMatch, SeasonSnapshot } from '../providers/types.ts';
import { inferRounds } from './rounds.ts';

export interface IngestSummary {
  source: string;
  season: number;
  matches: { total: number; inserted: number; updated: number; unchanged: number; finishedNow: number };
  events: number;
  rounds: { stage: string; rounds: number }[];
  issues: { info: number; warning: number; error: number };
  resolvedIssues: number;
}

export interface IngestDeps {
  competition: CompetitionConfig;
  teamOverrides: Record<string, TeamOverride>;
  logger: Logger;
  /** Inicio de la ejecución: las incidencias no vistas desde entonces se dan por resueltas. */
  runStartedAt?: string;
}

const GOAL_KINDS = new Set(['goal', 'own_goal', 'penalty_goal']);

export function ingestSnapshot(db: Db, snapshot: SeasonSnapshot, deps: IngestDeps): IngestSummary {
  const source = `${snapshot.provider}:${snapshot.competitionCode}`;
  const startedAt = deps.runStartedAt ?? nowIso();
  const issues: ProviderIssue[] = [...snapshot.issues];
  const comps = new CompetitionsRepo(db);
  const teams = new TeamsRepo(db, deps.teamOverrides);
  const matchesRepo = new MatchesRepo(db);
  const issuesRepo = new IssuesRepo(db);
  const summary: IngestSummary = {
    source,
    season: snapshot.season,
    matches: { total: snapshot.matches.length, inserted: 0, updated: 0, unchanged: 0, finishedNow: 0 },
    events: 0,
    rounds: [],
    issues: { info: 0, warning: 0, error: 0 },
    resolvedIssues: 0,
  };

  transaction(db, () => {
    const season = comps.ensureSeason(snapshot.competitionCode, deps.competition.nombre, deps.competition.tipo, snapshot.season);

    const teamIds = new Map<string, number>();
    for (const t of snapshot.teams) teamIds.set(t.externalId, teams.resolve(snapshot.provider, t, issues));

    const stageIds = new Map<string, number>();
    for (const s of snapshot.stages) stageIds.set(s.externalId, comps.upsertStage(season.seasonId, s));

    const groupIds = new Map<string, number>();
    for (const g of snapshot.groups) {
      const stageId = stageIds.get(g.stageExternalId);
      if (stageId === undefined) continue;
      const members = g.teamExternalIds.map((ext) => teamIds.get(ext)).filter((id): id is number => id !== undefined);
      if (members.length !== g.teamExternalIds.length) {
        issues.push({ severity: 'warning', code: 'GROUP_TEAM_UNKNOWN', entityRef: `${source}:group:${g.externalId}`, message: `El grupo ${g.name} incluye equipos que no aparecen en ningún partido` });
      }
      groupIds.set(`${g.stageExternalId}:${g.externalId}`, comps.upsertGroup(stageId, g, members));
    }

    saveReferenceStandings(db, snapshot, stageIds, groupIds, teamIds);

    const seenExternalIds = new Set<string>();
    for (const m of snapshot.matches) {
      const stageId = stageIds.get(m.stageExternalId);
      const homeId = teamIds.get(m.homeTeamExternalId);
      const awayId = teamIds.get(m.awayTeamExternalId);
      if (stageId === undefined || homeId === undefined || awayId === undefined) {
        issues.push({ severity: 'error', code: 'MATCH_REFERENCES_UNKNOWN', entityRef: `${source}:match:${m.externalId}`, message: `El partido ${m.externalId} referencia una fase o equipo desconocido; no se guarda` });
        continue;
      }
      seenExternalIds.add(m.externalId);
      const events = mapEvents(snapshot, m, teamIds, teams, issues, source);
      const eventsComplete = checkEvents(snapshot, m, events, homeId, awayId, issues, source);
      const winnerTeamId = m.winnerTeamExternalId ? (teamIds.get(m.winnerTeamExternalId) ?? null) : null;
      const isKnockout = snapshot.stages.find((s) => s.externalId === m.stageExternalId)?.kind === 'knockout';

      const row = {
        provider: snapshot.provider,
        externalId: m.externalId,
        stageId,
        groupId: m.groupExternalId ? (groupIds.get(`${m.stageExternalId}:${m.groupExternalId}`) ?? null) : null,
        round: isKnockout ? (m.round ?? null) : null,
        roundLabel: m.roundLabel ?? null,
        roundSource: isKnockout && m.round !== undefined ? ('provider' as const) : null,
        homeTeamId: homeId,
        awayTeamId: awayId,
        kickoffUtc: m.kickoffUtc,
        status: m.status,
        statusDetail: m.statusDetail ?? null,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        homePens: m.homePens ?? null,
        awayPens: m.awayPens ?? null,
        decidedBy: m.decidedBy ?? null,
        winnerTeamId,
        venue: m.venue ?? null,
        city: m.city ?? null,
        eventsComplete,
      };
      const contentHash = sha256(stableStringify({ ...row, events }));
      const res = matchesRepo.upsert({ ...row, contentHash }, events);
      summary.matches[res.outcome]++;
      if (res.becameFinished) summary.matches.finishedNow++;
      summary.events += events.length;
    }

    checkMissingMatches(db, snapshot, stageIds, seenExternalIds, issues, source);
    checkDuplicateFixtures(db, snapshot, stageIds, issues, source);
    summary.rounds = assignRounds(snapshot, stageIds, matchesRepo, issues, source);

    if (!snapshot.hasEventDetail) {
      issues.push({ severity: 'info', code: 'NO_EVENT_DETAIL', entityRef: source, message: `${deps.competition.nombre}: la fuente no entrega goleadores ni tarjetas; solo marcadores` });
    }

    const seenAt = nowIso();
    for (const issue of issues) {
      issuesRepo.record(source, issue, seenAt);
      summary.issues[issue.severity]++;
    }
    summary.resolvedIssues = issuesRepo.resolveNotSeenSince(source, startedAt);
  });

  for (const issue of issues.filter((i) => i.severity !== 'info')) {
    deps.logger[issue.severity === 'error' ? 'error' : 'warn'](`[${issue.code}] ${issue.message}`, { ref: issue.entityRef });
  }
  return summary;
}

function mapEvents(
  snapshot: SeasonSnapshot,
  m: ProviderMatch,
  teamIds: Map<string, number>,
  teams: TeamsRepo,
  issues: ProviderIssue[],
  source: string,
): EventInput[] {
  const out: EventInput[] = [];
  for (const e of m.events) {
    const teamId = teamIds.get(e.teamExternalId);
    if (teamId === undefined) {
      issues.push({ severity: 'warning', code: 'EVENT_TEAM_UNKNOWN', entityRef: `${source}:match:${m.externalId}`, message: `Evento ${e.kind} (${e.minuteLabel}) de un equipo que no juega este partido` });
      continue;
    }
    const playerTeam = e.player?.teamExternalId ? (teamIds.get(e.player.teamExternalId) ?? null) : e.kind === 'own_goal' ? null : teamId;
    const playerId = e.player ? teams.resolvePlayer(snapshot.provider, e.player, playerTeam) : null;
    out.push({ kind: e.kind, minute: e.minute, addedTime: e.addedTime, minuteLabel: e.minuteLabel, teamId, playerId });
  }
  return out;
}

/** Comprueba que los goles con detalle sumen el marcador; si no, lo registra. */
function checkEvents(
  snapshot: SeasonSnapshot,
  m: ProviderMatch,
  events: EventInput[],
  homeId: number,
  awayId: number,
  issues: ProviderIssue[],
  source: string,
): boolean {
  const played = m.status === 'finished' || m.status === 'live' || m.status === 'suspended';
  if (!played) return true;
  if (!snapshot.hasEventDetail) return (m.homeScore ?? 0) + (m.awayScore ?? 0) === 0;

  const ref = `${source}:match:${m.externalId}`;
  let complete = true;
  for (const [teamId, score] of [
    [homeId, m.homeScore],
    [awayId, m.awayScore],
  ] as const) {
    const goals = events.filter((e) => e.teamId === teamId && GOAL_KINDS.has(e.kind)).length;
    if (score !== null && goals !== score) {
      complete = false;
      issues.push({
        severity: 'warning',
        code: goals < score ? 'GOALS_WITHOUT_DETAIL' : 'GOALS_EXCEED_SCORE',
        entityRef: `${ref}:team:${teamId}`,
        message: `Partido ${m.externalId}: el marcador indica ${score} gol(es) del equipo #${teamId} pero hay ${goals} con detalle`,
      });
    }
  }
  const anonymous = events.filter((e) => GOAL_KINDS.has(e.kind) && e.playerId === null).length;
  if (anonymous > 0) {
    complete = false;
    issues.push({ severity: 'warning', code: 'GOAL_WITHOUT_SCORER', entityRef: ref, message: `Partido ${m.externalId}: ${anonymous} gol(es) sin autor registrado` });
  }
  return complete;
}

function saveReferenceStandings(
  db: Db,
  snapshot: SeasonSnapshot,
  stageIds: Map<string, number>,
  groupIds: Map<string, number>,
  teamIds: Map<string, number>,
): void {
  if (snapshot.referenceStandings.length === 0) return;
  const fetchedAt = nowIso();
  const touched = new Set(snapshot.referenceStandings.map((r) => stageIds.get(r.stageExternalId)).filter((id) => id !== undefined));
  for (const stageId of touched) run(db, 'DELETE FROM provider_standings WHERE stage_id = :s', { s: stageId });
  for (const r of snapshot.referenceStandings) {
    const stageId = stageIds.get(r.stageExternalId);
    const teamId = teamIds.get(r.teamExternalId);
    if (stageId === undefined || teamId === undefined) continue;
    const num = (n: number) => (Number.isFinite(n) ? n : null);
    run(
      db,
      `INSERT OR REPLACE INTO provider_standings (stage_id, group_id, team_id, played, points, goals_for, goals_against, fetched_at)
       VALUES (:s, :g, :t, :p, :pts, :gf, :ga, :at)`,
      {
        s: stageId,
        g: r.groupExternalId ? (groupIds.get(`${r.stageExternalId}:${r.groupExternalId}`) ?? null) : null,
        t: teamId,
        p: num(r.played),
        pts: num(r.points),
        gf: num(r.goalsFor),
        ga: num(r.goalsAgainst),
        at: fetchedAt,
      },
    );
  }
}

function checkMissingMatches(
  db: Db,
  snapshot: SeasonSnapshot,
  stageIds: Map<string, number>,
  seen: Set<string>,
  issues: ProviderIssue[],
  source: string,
): void {
  const ids = [...stageIds.values()];
  if (ids.length === 0) return;
  const stored = many<{ external_id: string; status: string }>(
    db,
    `SELECT external_id, status FROM matches WHERE provider = :p AND stage_id IN (${ids.join(',')})`,
    { p: snapshot.provider },
  );
  for (const row of stored) {
    if (seen.has(row.external_id)) continue;
    issues.push({
      severity: 'warning',
      code: 'MATCH_MISSING_FROM_SOURCE',
      entityRef: `${source}:match:${row.external_id}`,
      message: `El partido ${row.external_id} (estado ${row.status}) ya no aparece en la fuente; se conserva sin cambios`,
    });
  }
}

function checkDuplicateFixtures(db: Db, snapshot: SeasonSnapshot, stageIds: Map<string, number>, issues: ProviderIssue[], source: string): void {
  for (const stage of snapshot.stages) {
    if (stage.kind === 'knockout') continue;
    const stageId = stageIds.get(stage.externalId)!;
    const dups = many<{ home_team_id: number; away_team_id: number; n: number; ids: string }>(
      db,
      `SELECT home_team_id, away_team_id, COUNT(*) AS n, GROUP_CONCAT(external_id) AS ids FROM matches
       WHERE stage_id = :s AND status <> 'cancelled' GROUP BY home_team_id, away_team_id HAVING n > 1`,
      { s: stageId },
    );
    for (const d of dups) {
      issues.push({
        severity: 'warning',
        code: 'DUPLICATE_FIXTURE',
        entityRef: `${source}:stage:${stage.externalId}:${d.home_team_id}-${d.away_team_id}`,
        message: `${stage.name}: el cruce #${d.home_team_id} vs #${d.away_team_id} aparece ${d.n} veces (${d.ids})`,
      });
    }
  }
}

function assignRounds(
  snapshot: SeasonSnapshot,
  stageIds: Map<string, number>,
  repo: MatchesRepo,
  issues: ProviderIssue[],
  source: string,
): { stage: string; rounds: number }[] {
  const result: { stage: string; rounds: number }[] = [];
  for (const stage of snapshot.stages) {
    if (stage.kind === 'knockout') continue;
    const stageId = stageIds.get(stage.externalId)!;
    const rows = repo.forStage(stageId);
    const active = rows.filter((r) => r.status !== 'cancelled');
    const fixed = repo.roundOverrides(stageId);
    const { rounds, outliers } = inferRounds(
      active.map((r) => ({ id: r.id, kickoffUtc: r.kickoff_utc, homeTeamId: r.home_team_id, awayTeamId: r.away_team_id })),
      fixed,
    );
    for (const r of rows) {
      const round = rounds.get(r.id) ?? null;
      const src = fixed.has(r.id) ? 'manual' : 'inferred';
      if (r.round !== round || r.round_source !== src) repo.setRound(r.id, round, src);
    }
    for (const o of outliers) {
      const m = rows.find((r) => r.id === o.matchId)!;
      issues.push({
        severity: 'info',
        code: 'ROUND_RESCHEDULED',
        entityRef: `${source}:match:${m.external_id}`,
        message: `${stage.name}, fecha ${o.round}: el partido ${m.external_id} se juega ${Math.abs(o.daysFromRoundMedian)} días ${o.daysFromRoundMedian > 0 ? 'después' : 'antes'} que el resto de la fecha`,
      });
    }
    const cancelled = rows.length - active.length;
    if (cancelled > 0) {
      issues.push({ severity: 'info', code: 'MATCHES_CANCELLED', entityRef: `${source}:stage:${stage.externalId}`, message: `${stage.name}: ${cancelled} partido(s) cancelado(s) sin jornada asignada` });
    }
    result.push({ stage: stage.name, rounds: new Set(rounds.values()).size });
  }
  return result;
}
