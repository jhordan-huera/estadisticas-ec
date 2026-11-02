// Modelo plano que consume el motor de estadísticas. Es independiente de la base de
// datos: las funciones de cálculo son puras y se prueban con datos de ejemplo.

import type { EventKind, MatchStatus, StageKind } from '../providers/types.ts';

export interface StatTeam {
  id: number;
  name: string;
  shortName: string;
  abbr: string;
  color: string | null;
  textColor: string | null;
}

export interface StatPlayer {
  id: number;
  name: string;
  shortName: string;
  teamId: number | null;
}

export interface StatStage {
  id: number;
  name: string;
  kind: StageKind;
  order: number;
}

export interface StatGroup {
  id: number;
  stageId: number;
  name: string;
  teamIds: number[];
}

export interface StatMatch {
  id: number;
  stageId: number;
  groupId: number | null;
  round: number | null;
  roundLabel: string | null;
  kickoffUtc: string;
  status: MatchStatus;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  city: string | null;
  eventsComplete: boolean;
}

export interface StatEvent {
  matchId: number;
  seq: number;
  kind: EventKind;
  minute: number | null;
  addedTime: number | null;
  minuteLabel: string;
  teamId: number;
  playerId: number | null;
}

export interface PointAdjustment {
  teamId: number;
  points: number;
  reason: string;
  effectiveFrom: string;
}

export interface StatLineupPlayer {
  playerId: number;
  name: string;
  jersey: string | null;
  position: string | null;
  formationPlace: number | null;
  starter: boolean;
}

export interface StatLineup {
  teamId: number;
  formation: string | null;
  /** Camiseta del partido (#rrggbb) y color de sus detalles, si se conocen. */
  kitColor?: string | null;
  kitDetail?: string | null;
  players: StatLineupPlayer[];
}

export interface SeasonData {
  competitionCode: string;
  competitionName: string;
  year: number;
  stages: StatStage[];
  groups: StatGroup[];
  teams: Map<number, StatTeam>;
  players: Map<number, StatPlayer>;
  matches: StatMatch[];
  events: StatEvent[];
  adjustments: PointAdjustment[];
  /** Alineaciones guardadas, por partido. */
  lineups: Map<number, StatLineup[]>;
}

export type Outcome = 'W' | 'D' | 'L';

export function isFinished(m: StatMatch): m is StatMatch & { homeScore: number; awayScore: number } {
  return m.status === 'finished' && m.homeScore !== null && m.awayScore !== null;
}

/** Resultado del partido desde el punto de vista de un equipo. */
export function outcomeFor(m: StatMatch & { homeScore: number; awayScore: number }, teamId: number): Outcome {
  const own = m.homeTeamId === teamId ? m.homeScore : m.awayScore;
  const other = m.homeTeamId === teamId ? m.awayScore : m.homeScore;
  return own > other ? 'W' : own < other ? 'L' : 'D';
}

export function byKickoff(a: StatMatch, b: StatMatch): number {
  return a.kickoffUtc < b.kickoffUtc ? -1 : a.kickoffUtc > b.kickoffUtc ? 1 : a.id - b.id;
}
