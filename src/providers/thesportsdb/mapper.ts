// Traducción pura de TheSportsDB a nuestro contrato, para copas por eliminación.
// Limitaciones verificadas del plan gratuito: máx. 15 partidos por consulta, sin
// goleadores ni marcador de penales; cuartos, semis y final llegan todos como ronda 0.

import { teamNameKey } from '../../core/text.ts';
import { toIsoUtc } from '../../core/time.ts';
import type { MatchStatus, ProviderIssue, ProviderMatch, ProviderTeam } from '../types.ts';
import type { TsdbEvent } from './raw.ts';

export const STAGE_ID = 'eliminatorias';

export interface TsdbMapInput {
  competitionCode: string;
  events: TsdbEvent[];
  rounds: number[];
  roundLabels?: Record<string, string>;
}

export function mapTsdbEvents(input: TsdbMapInput): { teams: ProviderTeam[]; matches: ProviderMatch[]; issues: ProviderIssue[] } {
  const issues: ProviderIssue[] = [];
  const teams = new Map<string, ProviderTeam>();
  const matches: ProviderMatch[] = [];
  const roundOrder = new Map(input.rounds.map((r, i) => [r, i + 1]));

  for (const e of input.events) {
    const ref = `thesportsdb:event:${e.idEvent}`;
    const kickoff = kickoffOf(e);
    if (!kickoff) {
      issues.push({ severity: 'error', code: 'TSDB_NO_DATE', entityRef: ref, message: `Partido ${e.idEvent} (${e.strHomeTeam} - ${e.strAwayTeam}) sin fecha; no se guarda` });
      continue;
    }
    const roundCode = e.intRound !== null && e.intRound !== undefined && e.intRound !== '' ? Number(e.intRound) : NaN;
    let round = roundOrder.get(roundCode);
    if (round === undefined) {
      issues.push({ severity: 'warning', code: 'TSDB_ROUND_NOT_CONFIGURED', entityRef: `${ref}:ronda:${e.intRound}`, message: `Ronda ${e.intRound} no está en la configuración de ${input.competitionCode}` });
      round = input.rounds.length + 1;
    }
    teams.set(e.idHomeTeam, teamOf(e.idHomeTeam, e.strHomeTeam));
    teams.set(e.idAwayTeam, teamOf(e.idAwayTeam, e.strAwayTeam));

    const { status, decidedBy } = mapStatus(e, ref, issues);
    const played = status === 'finished' || status === 'live';
    matches.push({
      externalId: e.idEvent,
      stageExternalId: STAGE_ID,
      round,
      roundLabel: input.roundLabels?.[String(roundCode)] ?? `Ronda ${e.intRound ?? '?'}`,
      kickoffUtc: kickoff,
      status,
      statusDetail: e.strStatus ?? undefined,
      homeTeamExternalId: e.idHomeTeam,
      awayTeamExternalId: e.idAwayTeam,
      homeScore: played ? toInt(e.intHomeScore) : null,
      awayScore: played ? toInt(e.intAwayScore) : null,
      homePens: null,
      awayPens: null,
      decidedBy,
      venue: e.strVenue || undefined,
      events: [],
    });
  }

  inferPenaltyWinners(matches, issues);
  return { teams: [...teams.values()], matches, issues };
}

function kickoffOf(e: TsdbEvent): string | undefined {
  try {
    if (e.strTimestamp) return toIsoUtc(e.strTimestamp);
    if (e.dateEvent) return toIsoUtc(`${e.dateEvent}T${e.strTime || '00:00:00'}`);
  } catch {
    return undefined;
  }
  return undefined;
}

function toInt(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

const STATUS: Record<string, { status: MatchStatus; decidedBy?: 'regular' | 'extra_time' | 'penalties' }> = {
  NS: { status: 'scheduled' },
  'NOT STARTED': { status: 'scheduled' },
  TBD: { status: 'scheduled' },
  FT: { status: 'finished', decidedBy: 'regular' },
  'MATCH FINISHED': { status: 'finished', decidedBy: 'regular' },
  AET: { status: 'finished', decidedBy: 'extra_time' },
  PEN: { status: 'finished', decidedBy: 'penalties' },
  AP: { status: 'finished', decidedBy: 'penalties' },
  PST: { status: 'postponed' },
  POSTPONED: { status: 'postponed' },
  CANC: { status: 'cancelled' },
  CANCELLED: { status: 'cancelled' },
  ABD: { status: 'suspended' },
  SUSP: { status: 'suspended' },
  '1H': { status: 'live' },
  HT: { status: 'live' },
  '2H': { status: 'live' },
  ET: { status: 'live' },
  BT: { status: 'live' },
  P: { status: 'live' },
  LIVE: { status: 'live' },
};

function mapStatus(e: TsdbEvent, ref: string, issues: ProviderIssue[]): { status: MatchStatus; decidedBy?: 'regular' | 'extra_time' | 'penalties' } {
  if (e.strPostponed === 'yes') return { status: 'postponed' };
  const key = (e.strStatus ?? '').trim().toUpperCase();
  const known = STATUS[key];
  if (known) return known;
  const hasScore = toInt(e.intHomeScore) !== null && toInt(e.intAwayScore) !== null;
  // Partido aún sin jugar: la fuente deja el estado vacío y no hay marcador.
  if (key === '' && !hasScore) return { status: 'scheduled' };
  issues.push({
    severity: 'warning',
    code: 'TSDB_STATUS_UNKNOWN',
    entityRef: ref,
    message: `Estado "${e.strStatus ?? ''}" desconocido; se toma como ${hasScore ? 'finalizado' : 'programado'} según el marcador`,
  });
  return hasScore ? { status: 'finished', decidedBy: 'regular' } : { status: 'scheduled' };
}

/**
 * Sin marcador de penales, el ganador se deduce de quién aparece en una ronda posterior.
 * Si no se puede deducir, queda registrado como incidencia.
 */
function inferPenaltyWinners(matches: ProviderMatch[], issues: ProviderIssue[]): void {
  for (const m of matches) {
    if (m.decidedBy !== 'penalties' || m.homePens !== null) continue;
    const later = matches.filter((x) => (x.round ?? 0) > (m.round ?? 0) || (x.round === m.round && x.kickoffUtc > m.kickoffUtc));
    const homeLater = later.some((x) => x.homeTeamExternalId === m.homeTeamExternalId || x.awayTeamExternalId === m.homeTeamExternalId);
    const awayLater = later.some((x) => x.homeTeamExternalId === m.awayTeamExternalId || x.awayTeamExternalId === m.awayTeamExternalId);
    if (homeLater !== awayLater) {
      m.winnerTeamExternalId = homeLater ? m.homeTeamExternalId : m.awayTeamExternalId;
      issues.push({ severity: 'info', code: 'TSDB_PENS_WINNER_INFERRED', entityRef: `thesportsdb:event:${m.externalId}`, message: 'Ganador por penales deducido de la ronda siguiente (la fuente no trae el marcador de la tanda)' });
    } else {
      issues.push({ severity: 'warning', code: 'TSDB_PENS_WINNER_UNKNOWN', entityRef: `thesportsdb:event:${m.externalId}`, message: 'Partido definido por penales sin ganador conocido' });
    }
  }
}

const NAME_STOPWORDS = new Set(['deportivo', 'club', 'sociedad', 'atletico', 'cd', 'sd', 'ud', 'de', 'del', 'la', 'el']);

function teamOf(id: string, name: string): ProviderTeam {
  const words = teamNameKey(name).split(' ').filter(Boolean);
  const main = words.find((w) => !NAME_STOPWORDS.has(w)) ?? words[0] ?? name;
  return { externalId: id, name, shortName: name, abbr: main.slice(0, 3).toUpperCase() };
}
