// Contrato entre las fuentes de datos y el resto del sistema.
// Un proveedor solo traduce su API a estas estructuras; no conoce la base de datos.
// Para cambiar de fuente (datos de un club, una licencia oficial…) basta con
// implementar DataProvider y registrarlo en providers/registry.ts.

import type { CompetitionConfig } from '../core/config.ts';

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'suspended' | 'cancelled';
export type StageKind = 'league' | 'groups' | 'knockout';
export type EventKind = 'goal' | 'own_goal' | 'penalty_goal' | 'yellow_card' | 'red_card';
export type IssueSeverity = 'info' | 'warning' | 'error';

export interface ProviderTeam {
  externalId: string;
  name: string;
  shortName: string;
  abbr: string;
  color?: string;
  altColor?: string;
}

export interface ProviderStage {
  externalId: string;
  name: string;
  kind: StageKind;
  order: number;
  startsAt?: string;
  endsAt?: string;
}

export interface ProviderGroup {
  externalId: string;
  stageExternalId: string;
  name: string;
  teamExternalIds: string[];
}

export interface ProviderPlayer {
  externalId: string;
  name: string;
  shortName?: string;
  teamExternalId?: string;
}

export interface ProviderMatchEvent {
  kind: EventKind;
  minute: number | null;
  addedTime: number | null;
  minuteLabel: string;
  /** Equipo al que se le acredita el evento (en un autogol, el beneficiado). */
  teamExternalId: string;
  player?: ProviderPlayer;
}

export interface ProviderMatch {
  externalId: string;
  stageExternalId: string;
  groupExternalId?: string;
  /** Jornada si el proveedor la entrega; si no, se infiere al sincronizar. */
  round?: number;
  roundLabel?: string;
  kickoffUtc: string;
  status: MatchStatus;
  statusDetail?: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  homeScore: number | null;
  awayScore: number | null;
  homePens?: number | null;
  awayPens?: number | null;
  decidedBy?: 'regular' | 'extra_time' | 'penalties';
  /** Solo cuando el ganador no se deduce del marcador (p. ej. penales sin detalle). */
  winnerTeamExternalId?: string;
  venue?: string;
  city?: string;
  events: ProviderMatchEvent[];
}

export interface ProviderIssue {
  severity: IssueSeverity;
  code: string;
  entityRef: string;
  message: string;
}

/** Fila de tabla calculada por el proveedor, solo para contrastar con la nuestra. */
export interface ReferenceStanding {
  stageExternalId: string;
  groupExternalId?: string;
  teamExternalId: string;
  played: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface SeasonSnapshot {
  provider: string;
  competitionCode: string;
  season: number;
  /** false si el proveedor no entrega goleadores/tarjetas para esta competición. */
  hasEventDetail: boolean;
  teams: ProviderTeam[];
  stages: ProviderStage[];
  groups: ProviderGroup[];
  matches: ProviderMatch[];
  referenceStandings: ReferenceStanding[];
  issues: ProviderIssue[];
}

/** Alineación de un equipo en un partido. */
export interface ProviderLineup {
  teamExternalId: string;
  /** "4-2-3-1" (puede faltar). */
  formation: string | null;
  /** Colores de la camiseta que usa en ese partido, si el proveedor los informa. */
  kit: { color: string; detail: string | null } | null;
  players: {
    externalId: string;
    name: string;
    shortName: string;
    jersey: string | null;
    /** Abreviatura de la posición del proveedor: "G", "CD-L", "RB", "AM-R", "F"… */
    position: string | null;
    /** Lugar en el esquema (1 = arquero), si el proveedor lo da. */
    formationPlace: number | null;
    starter: boolean;
  }[];
}

export interface LineupRequest {
  competition: CompetitionConfig;
  matchExternalId: string;
}

export interface SeasonRequest {
  competitionCode: string;
  competition: CompetitionConfig;
  season: number;
}

export interface DataProvider {
  readonly id: string;
  fetchSeason(request: SeasonRequest): Promise<SeasonSnapshot>;
  /** Alineaciones de un partido; lista vacía si aún no se publicaron. Opcional por proveedor. */
  fetchLineups?(request: LineupRequest): Promise<ProviderLineup[]>;
}
