// Forma de las respuestas de ESPN, limitada a los campos que usamos
// (verificada contra respuestas reales de ecu.1, temporada 2026).

export interface EspnStatus {
  displayClock?: string;
  type: {
    name: string;
    state: 'pre' | 'in' | 'post';
    completed: boolean;
    description?: string;
    shortDetail?: string;
  };
}

export interface EspnTeam {
  id: string;
  abbreviation?: string;
  displayName: string;
  shortDisplayName?: string;
  color?: string;
  alternateColor?: string;
}

export interface EspnCompetitor {
  id: string;
  homeAway: 'home' | 'away';
  score?: string;
  winner?: boolean;
  shootoutScore?: number;
  team: EspnTeam;
}

export interface EspnAthlete {
  id: string;
  displayName: string;
  shortName?: string;
  team?: { id: string };
}

export interface EspnDetail {
  type: { id: string; text?: string };
  clock?: { value?: number; displayValue?: string };
  team?: { id: string };
  scoringPlay?: boolean;
  redCard?: boolean;
  yellowCard?: boolean;
  penaltyKick?: boolean;
  ownGoal?: boolean;
  shootout?: boolean;
  athletesInvolved?: EspnAthlete[];
}

export interface EspnCompetition {
  id: string;
  venue?: { fullName?: string; address?: { city?: string } };
  competitors: EspnCompetitor[];
  details?: EspnDetail[];
}

export interface EspnEvent {
  id: string;
  date: string;
  name?: string;
  season?: { year?: number; type?: number; slug?: string };
  status: EspnStatus;
  competitions: EspnCompetition[];
}

export interface EspnScoreboard {
  events?: EspnEvent[];
}

export interface EspnRefList {
  items?: { $ref: string }[];
}

export interface EspnSeasonType {
  id: string;
  type: number;
  name: string;
  abbreviation?: string;
  startDate: string;
  endDate: string;
  hasGroups: boolean;
  slug?: string;
}

export interface EspnStandingEntry {
  team: EspnTeam;
  stats: { name: string; value?: number; displayValue?: string }[];
}

export interface EspnStandingsGroup {
  id: string;
  name: string;
  standings: { season?: number; seasonType?: number; entries: EspnStandingEntry[] };
}

export interface EspnStandings {
  children?: EspnStandingsGroup[];
  standings?: { season?: number; seasonType?: number; entries: EspnStandingEntry[] };
}
