// Traducción pura (sin red) de las respuestas de ESPN al contrato de proveedores.
// Corrige dos defectos verificados de ESPN para ecu.1:
//  1. La etiqueta de fase (season.type) es incorrecta en algunos partidos: la fase
//     se decide por la fecha del partido dentro de las ventanas de cada fase.
//  2. El campo `group` del scoreboard no es fiable: el grupo se toma de la tabla.

import { toIsoUtc } from '../../core/time.ts';
import type {
  EventKind,
  MatchStatus,
  ProviderGroup,
  ProviderIssue,
  ProviderLineup,
  ProviderMatch,
  ProviderMatchEvent,
  ProviderStage,
  ProviderTeam,
  ReferenceStanding,
} from '../types.ts';
import type { EspnCompetitor, EspnDetail, EspnEvent, EspnSeasonType, EspnStandings, EspnStatus, EspnSummary, EspnTeam } from './raw.ts';

export interface EspnMapInput {
  seasonTypes: EspnSeasonType[];
  standings: EspnStandings;
  events: EspnEvent[];
  season: number;
  stageNames?: Record<string, string>;
  groupNames?: Record<string, string>;
}

export interface EspnMapOutput {
  teams: ProviderTeam[];
  stages: ProviderStage[];
  groups: ProviderGroup[];
  matches: ProviderMatch[];
  referenceStandings: ReferenceStanding[];
  issues: ProviderIssue[];
}

export function mapEspnSeason(input: EspnMapInput): EspnMapOutput {
  const issues: ProviderIssue[] = [];
  const stages = mapStages(input.seasonTypes, input.stageNames);
  const { groups, referenceStandings } = mapStandings(input.standings, stages, input.groupNames, issues);

  const groupOfTeam = new Map<string, Map<string, string>>(); // stage -> team -> group
  for (const g of groups) {
    let byTeam = groupOfTeam.get(g.stageExternalId);
    if (!byTeam) groupOfTeam.set(g.stageExternalId, (byTeam = new Map()));
    for (const t of g.teamExternalIds) byTeam.set(t, g.externalId);
  }
  const stageByTypeCode = new Map(input.seasonTypes.map((t) => [t.type, t.id]));

  const teams = new Map<string, ProviderTeam>();
  const matches: ProviderMatch[] = [];

  for (const event of input.events) {
    if (event.season?.year !== undefined && event.season.year !== input.season) {
      issues.push({
        severity: 'info',
        code: 'ESPN_EVENT_OTHER_SEASON',
        entityRef: `espn:event:${event.id}`,
        message: `Partido ${event.id} pertenece a la temporada ${event.season.year}; se excluye de ${input.season}`,
      });
      continue;
    }
    const match = mapEvent(event, stages, stageByTypeCode, groupOfTeam, teams, issues);
    if (match) matches.push(match);
  }

  return { teams: [...teams.values()], stages, groups, matches, referenceStandings, issues };
}

function mapStages(types: EspnSeasonType[], names: Record<string, string> = {}): ProviderStage[] {
  return [...types]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((t, index) => ({
      externalId: t.id,
      name: names[t.id] ?? t.name,
      kind: t.hasGroups ? 'groups' : 'league',
      order: index + 1,
      startsAt: toIsoUtc(t.startDate),
      endsAt: toIsoUtc(t.endDate),
    }));
}

function mapStandings(
  standings: EspnStandings,
  stages: ProviderStage[],
  groupNames: Record<string, string> = {},
  issues: ProviderIssue[],
): { groups: ProviderGroup[]; referenceStandings: ReferenceStanding[] } {
  const groups: ProviderGroup[] = [];
  const referenceStandings: ReferenceStanding[] = [];
  const blocks = standings.children?.length
    ? standings.children.map((c) => ({ groupId: c.id, name: c.name, table: c.standings }))
    : standings.standings
      ? [{ groupId: undefined, name: undefined, table: standings.standings }]
      : [];

  for (const block of blocks) {
    const stageId = block.table.seasonType !== undefined ? String(block.table.seasonType) : undefined;
    const stage = stages.find((s) => s.externalId === stageId);
    if (!stage) {
      issues.push({
        severity: 'warning',
        code: 'ESPN_STANDINGS_STAGE_UNKNOWN',
        entityRef: `espn:standings:${stageId ?? 'sin-fase'}`,
        message: `La tabla de ESPN hace referencia a una fase desconocida (${stageId ?? 'sin fase'})`,
      });
      continue;
    }
    const isGroup = stage.kind === 'groups' && block.groupId !== undefined;
    if (isGroup) {
      groups.push({
        externalId: block.groupId!,
        stageExternalId: stage.externalId,
        name: groupNames[block.groupId!] ?? block.name ?? `Grupo ${block.groupId}`,
        teamExternalIds: block.table.entries.map((e) => e.team.id),
      });
    }
    for (const entry of block.table.entries) {
      const stat = (name: string) => entry.stats.find((s) => s.name === name)?.value ?? NaN;
      referenceStandings.push({
        stageExternalId: stage.externalId,
        groupExternalId: isGroup ? block.groupId : undefined,
        teamExternalId: entry.team.id,
        played: stat('gamesPlayed'),
        points: stat('points'),
        goalsFor: stat('pointsFor'),
        goalsAgainst: stat('pointsAgainst'),
      });
    }
  }
  return { groups, referenceStandings };
}

function mapEvent(
  event: EspnEvent,
  stages: ProviderStage[],
  stageByTypeCode: Map<number, string>,
  groupOfTeam: Map<string, Map<string, string>>,
  teams: Map<string, ProviderTeam>,
  issues: ProviderIssue[],
): ProviderMatch | undefined {
  const ref = `espn:event:${event.id}`;
  const competition = event.competitions?.[0];
  const home = competition?.competitors.find((c) => c.homeAway === 'home');
  const away = competition?.competitors.find((c) => c.homeAway === 'away');
  if (!competition || !home || !away) {
    issues.push({ severity: 'error', code: 'ESPN_EVENT_MALFORMED', entityRef: ref, message: `Partido ${event.id} sin local/visitante; no se puede guardar` });
    return undefined;
  }
  teams.set(home.team.id, mapTeam(home.team));
  teams.set(away.team.id, mapTeam(away.team));

  const kickoffUtc = toIsoUtc(event.date);
  const byDate = stages.find((s) => s.startsAt && s.endsAt && s.startsAt <= kickoffUtc && kickoffUtc <= endOfMinute(s.endsAt));
  const labelled = event.season?.type !== undefined ? stageByTypeCode.get(event.season.type) : undefined;
  const stageId = byDate?.externalId ?? labelled;
  if (!stageId) {
    issues.push({ severity: 'error', code: 'ESPN_STAGE_UNRESOLVED', entityRef: ref, message: `No se pudo ubicar la fase del partido ${event.id} (${kickoffUtc})` });
    return undefined;
  }
  if (byDate && labelled && labelled !== byDate.externalId) {
    issues.push({
      severity: 'info',
      code: 'ESPN_STAGE_LABEL_CORRECTED',
      entityRef: ref,
      message: `ESPN etiqueta el partido ${event.id} (${event.name ?? ''}) en la fase ${labelled}, pero su fecha corresponde a la fase ${byDate.externalId}`,
    });
  }

  let groupExternalId: string | undefined;
  const stage = stages.find((s) => s.externalId === stageId)!;
  if (stage.kind === 'groups') {
    const byTeam = groupOfTeam.get(stageId);
    const gh = byTeam?.get(home.team.id);
    const ga = byTeam?.get(away.team.id);
    if (gh && gh === ga) groupExternalId = gh;
    else {
      issues.push({
        severity: 'warning',
        code: 'ESPN_GROUP_UNRESOLVED',
        entityRef: ref,
        message: `No se pudo determinar el grupo del partido ${event.id}: local en ${gh ?? '?'}, visitante en ${ga ?? '?'}`,
      });
    }
  }

  const { status, decidedBy } = mapStatus(event.status, ref, issues);
  const hasScore = status === 'finished' || status === 'live' || status === 'suspended';
  const events = mapDetails(competition.details ?? [], ref, issues);

  return {
    externalId: event.id,
    stageExternalId: stageId,
    groupExternalId,
    kickoffUtc,
    status,
    statusDetail: event.status.type.shortDetail ?? event.status.type.description,
    homeTeamExternalId: home.team.id,
    awayTeamExternalId: away.team.id,
    homeScore: hasScore ? parseScore(home) : null,
    awayScore: hasScore ? parseScore(away) : null,
    homePens: home.shootoutScore ?? null,
    awayPens: away.shootoutScore ?? null,
    decidedBy,
    venue: competition.venue?.fullName,
    city: competition.venue?.address?.city,
    events,
  };
}

function mapTeam(team: EspnTeam): ProviderTeam {
  return {
    externalId: team.id,
    name: team.displayName,
    shortName: team.shortDisplayName ?? team.displayName,
    abbr: team.abbreviation ?? team.displayName.slice(0, 3).toUpperCase(),
    color: team.color ? `#${team.color.toLowerCase()}` : undefined,
    altColor: team.alternateColor ? `#${team.alternateColor.toLowerCase()}` : undefined,
  };
}

export function mapStatus(
  status: EspnStatus,
  ref: string,
  issues: ProviderIssue[],
): { status: MatchStatus; decidedBy?: 'regular' | 'extra_time' | 'penalties' } {
  const name = status.type.name;
  if (/POSTPONED/.test(name)) return { status: 'postponed' };
  if (/CANCEL/.test(name)) return { status: 'cancelled' };
  if (/ABANDONED|SUSPENDED|DELAYED/.test(name)) return { status: 'suspended' };
  switch (status.type.state) {
    case 'pre':
      return { status: 'scheduled' };
    case 'in':
      return { status: 'live' };
    case 'post':
      if (status.type.completed) {
        if (/PEN/.test(name)) return { status: 'finished', decidedBy: 'penalties' };
        if (/AET|EXTRA/.test(name)) return { status: 'finished', decidedBy: 'extra_time' };
        return { status: 'finished', decidedBy: 'regular' };
      }
      issues.push({ severity: 'warning', code: 'ESPN_STATUS_UNEXPECTED', entityRef: ref, message: `Estado "${name}" terminado pero no completado; se marca como suspendido` });
      return { status: 'suspended' };
  }
  issues.push({ severity: 'error', code: 'ESPN_STATUS_UNKNOWN', entityRef: ref, message: `Estado desconocido "${name}"; se trata como programado` });
  return { status: 'scheduled' };
}

function parseScore(c: EspnCompetitor): number | null {
  if (c.score === undefined || c.score === '') return null;
  const n = Number(c.score);
  return Number.isInteger(n) ? n : null;
}

/** "45'+1'" → { minute: 45, addedTime: 1, label: "45+1'" } */
export function parseMinute(display: string | undefined, seconds: number | undefined): { minute: number | null; addedTime: number | null; label: string } {
  const m = display?.match(/^(\d+)'?(?:\s*\+\s*(\d+)'?)?/);
  if (m) {
    const minute = Number(m[1]);
    const addedTime = m[2] ? Number(m[2]) : null;
    return { minute, addedTime, label: addedTime ? `${minute}+${addedTime}'` : `${minute}'` };
  }
  if (seconds !== undefined && Number.isFinite(seconds)) {
    const minute = Math.max(1, Math.ceil(seconds / 60));
    return { minute, addedTime: null, label: `${minute}'` };
  }
  return { minute: null, addedTime: null, label: '—' };
}

function mapDetails(details: EspnDetail[], ref: string, issues: ProviderIssue[]): ProviderMatchEvent[] {
  const out: ProviderMatchEvent[] = [];
  for (const d of details) {
    if (d.shootout) continue; // la tanda de penales va en homePens/awayPens
    let kind: EventKind | undefined;
    if (d.scoringPlay) kind = d.ownGoal ? 'own_goal' : d.penaltyKick ? 'penalty_goal' : 'goal';
    else if (d.redCard) kind = 'red_card';
    else if (d.yellowCard) kind = 'yellow_card';
    if (!kind) {
      issues.push({
        severity: 'info',
        code: 'ESPN_DETAIL_IGNORED',
        entityRef: `${ref}:tipo:${d.type.id}`,
        message: `Evento de tipo "${d.type.text ?? d.type.id}" no utilizado`,
      });
      continue;
    }
    if (!d.team?.id) {
      issues.push({ severity: 'warning', code: 'ESPN_DETAIL_NO_TEAM', entityRef: ref, message: `Evento ${kind} sin equipo; no se puede atribuir` });
      continue;
    }
    const minute = parseMinute(d.clock?.displayValue, d.clock?.value);
    const athlete = d.athletesInvolved?.[0];
    out.push({
      kind,
      minute: minute.minute,
      addedTime: minute.addedTime,
      minuteLabel: minute.label,
      teamExternalId: d.team.id,
      player: athlete
        ? { externalId: athlete.id, name: athlete.displayName, shortName: athlete.shortName, teamExternalId: athlete.team?.id }
        : undefined,
    });
  }
  return out;
}

/** ESPN publica el fin de fase como "03:59Z"; se incluye el minuto completo. */
function endOfMinute(iso: string): string {
  return iso.replace(/:00Z$/, ':59Z');
}

/** Alineaciones del endpoint summary. Lista vacía si ESPN todavía no las publicó. */
export function mapEspnLineups(summary: EspnSummary): ProviderLineup[] {
  return (summary.rosters ?? [])
    .filter((r) => (r.roster ?? []).length > 0)
    .map((r) => ({
      teamExternalId: r.team.id,
      formation: r.formation?.trim() || null,
      players: (r.roster ?? []).map((p) => {
        const place = p.formationPlace === undefined || p.formationPlace === '' ? NaN : Number(p.formationPlace);
        return {
          externalId: p.athlete.id,
          name: p.athlete.displayName,
          shortName: p.athlete.lastName || p.athlete.shortName || p.athlete.displayName,
          jersey: p.jersey ?? null,
          position: p.position?.abbreviation ?? null,
          formationPlace: Number.isFinite(place) && place > 0 ? place : null,
          starter: p.starter === true,
        };
      }),
    }));
}
