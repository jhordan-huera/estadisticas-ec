// Campos de TheSportsDB (API v1 gratuita) que usamos, verificados con Copa Ecuador
// (5636) y Supercopa Ecuador (5884). strTimestamp está en UTC; strTimeLocal no es fiable.

export interface TsdbEvent {
  idEvent: string;
  idLeague?: string;
  strSeason?: string;
  intRound?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strTimestamp?: string | null;
  idHomeTeam: string;
  idAwayTeam: string;
  strHomeTeam: string;
  strAwayTeam: string;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  strStatus?: string | null;
  strPostponed?: string | null;
  strVenue?: string | null;
}

export interface TsdbEventsResponse {
  events?: TsdbEvent[] | null;
  results?: TsdbEvent[] | null;
}
