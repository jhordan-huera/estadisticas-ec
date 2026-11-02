// Constructores de datos de ejemplo para las pruebas (temporadas pequeñas y legibles).

import { DEFAULT_TABLE_RULES, type TableRules } from '../src/core/config.ts';
import { createViewContext, type ViewContext } from '../src/content/views.ts';
import type { EventKind } from '../src/providers/types.ts';
import type { SeasonData, StatEvent, StatMatch, StatPlayer, StatTeam } from '../src/stats/types.ts';

export function team(id: number, name: string, abbr: string): StatTeam {
  return { id, name, shortName: name, abbr, color: '#336699', textColor: null };
}

export const A = team(1, 'Atlético Andino', 'AND');
export const B = team(2, 'Barrio Bravo', 'BRV');
export const C = team(3, 'Costa Celeste', 'CEL');
export const D = team(4, 'Deportivo Delta', 'DEL');

export function player(id: number, name: string, teamId: number): StatPlayer {
  return { id, name, shortName: name, teamId };
}

let matchSeq = 1000;

export interface MatchOpts {
  id?: number;
  round?: number;
  status?: StatMatch['status'];
  stageId?: number;
  groupId?: number | null;
  venue?: string;
}

/** Partido finalizado (o con el estado indicado) con marcador local-visitante. */
export function match(home: StatTeam, away: StatTeam, score: [number, number] | null, kickoffUtc: string, opts: MatchOpts = {}): StatMatch {
  const status = opts.status ?? (score ? 'finished' : 'scheduled');
  return {
    id: opts.id ?? ++matchSeq,
    stageId: opts.stageId ?? 1,
    groupId: opts.groupId ?? null,
    round: opts.round ?? 1,
    roundLabel: null,
    kickoffUtc,
    status,
    homeTeamId: home.id,
    awayTeamId: away.id,
    homeScore: score ? score[0] : null,
    awayScore: score ? score[1] : null,
    venue: opts.venue ?? null,
    city: null,
    eventsComplete: true,
  };
}

let eventSeq = 0;

export function event(m: StatMatch, kind: EventKind, teamId: number, playerId: number | null, minute: number, addedTime: number | null = null): StatEvent {
  return {
    matchId: m.id,
    seq: eventSeq++,
    kind,
    minute,
    addedTime,
    minuteLabel: addedTime ? `${minute}+${addedTime}'` : `${minute}'`,
    teamId,
    playerId,
  };
}

export function season(matches: StatMatch[], extra: Partial<SeasonData> = {}): SeasonData {
  const teams = new Map<number, StatTeam>();
  for (const t of [A, B, C, D]) teams.set(t.id, t);
  return {
    competitionCode: 'prueba',
    competitionName: 'Liga de Prueba',
    year: 2026,
    stages: [{ id: 1, name: 'Fase única', kind: 'league', order: 1 }],
    groups: [],
    teams,
    players: new Map(),
    matches,
    events: [],
    adjustments: [],
    ...extra,
  };
}

export function ctxFor(data: SeasonData, rules: TableRules = DEFAULT_TABLE_RULES): ViewContext {
  return createViewContext(data, rules, new Map(), 'America/Guayaquil');
}
