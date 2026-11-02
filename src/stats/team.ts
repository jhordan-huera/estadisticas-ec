// Estadísticas por equipo: racha de los últimos 5, goles a favor y en contra,
// rendimiento de local y de visitante, porterías en cero y rachas vigentes.

import { byKickoff, isFinished, outcomeFor, type Outcome, type StatEvent, type StatMatch, type StatPlayer } from './types.ts';

export interface SplitStats {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  cleanSheets: number;
  failedToScore: number;
}

export interface FormEntry {
  matchId: number;
  outcome: Outcome;
  opponentId: number;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  kickoffUtc: string;
}

export interface Streaks {
  wins: number;
  unbeaten: number;
  losses: number;
  winless: number;
  draws: number;
  /** Partidos seguidos sin recibir goles. */
  cleanSheets: number;
  /** Partidos seguidos marcando. */
  scoring: number;
}

export interface TeamProfile {
  teamId: number;
  total: SplitStats;
  home: SplitStats;
  away: SplitStats;
  /** Últimos 5 partidos, del más antiguo al más reciente. */
  last5: FormEntry[];
  streaks: Streaks;
  biggestWin: FormEntry | null;
  biggestLoss: FormEntry | null;
}

export interface TeamProfileOptions {
  pointsWin?: number;
  pointsDraw?: number;
  until?: string;
}

export function teamProfile(teamId: number, matches: StatMatch[], options: TeamProfileOptions = {}): TeamProfile {
  const pw = options.pointsWin ?? 3;
  const pd = options.pointsDraw ?? 1;
  const games = matches
    .filter(isFinished)
    .filter((m) => (m.homeTeamId === teamId || m.awayTeamId === teamId) && (!options.until || m.kickoffUtc < options.until))
    .sort(byKickoff);

  const total = emptySplit();
  const home = emptySplit();
  const away = emptySplit();
  const entries: FormEntry[] = [];

  for (const m of games) {
    const isHome = m.homeTeamId === teamId;
    const entry: FormEntry = {
      matchId: m.id,
      outcome: outcomeFor(m, teamId),
      opponentId: isHome ? m.awayTeamId : m.homeTeamId,
      home: isHome,
      goalsFor: isHome ? m.homeScore : m.awayScore,
      goalsAgainst: isHome ? m.awayScore : m.homeScore,
      kickoffUtc: m.kickoffUtc,
    };
    entries.push(entry);
    for (const split of [total, isHome ? home : away]) addTo(split, entry, pw, pd);
  }

  return {
    teamId,
    total,
    home,
    away,
    last5: entries.slice(-5),
    streaks: currentStreaks(entries),
    biggestWin: pickExtreme(entries, 'W'),
    biggestLoss: pickExtreme(entries, 'L'),
  };
}

/** Rachas vigentes contando desde el partido más reciente hacia atrás. */
export function currentStreaks(entries: FormEntry[]): Streaks {
  const count = (pred: (e: FormEntry) => boolean) => {
    let n = 0;
    for (let i = entries.length - 1; i >= 0 && pred(entries[i]!); i--) n++;
    return n;
  };
  return {
    wins: count((e) => e.outcome === 'W'),
    unbeaten: count((e) => e.outcome !== 'L'),
    losses: count((e) => e.outcome === 'L'),
    winless: count((e) => e.outcome !== 'W'),
    draws: count((e) => e.outcome === 'D'),
    cleanSheets: count((e) => e.goalsAgainst === 0),
    scoring: count((e) => e.goalsFor > 0),
  };
}

function pickExtreme(entries: FormEntry[], outcome: 'W' | 'L'): FormEntry | null {
  let best: FormEntry | null = null;
  for (const e of entries) {
    if (e.outcome !== outcome) continue;
    const margin = Math.abs(e.goalsFor - e.goalsAgainst);
    const bestMargin = best ? Math.abs(best.goalsFor - best.goalsAgainst) : -1;
    // Ante igual diferencia gana la de más goles; luego la más reciente.
    if (margin > bestMargin || (margin === bestMargin && best && e.goalsFor + e.goalsAgainst >= best.goalsFor + best.goalsAgainst)) best = e;
  }
  return best;
}

function addTo(s: SplitStats, e: FormEntry, pw: number, pd: number): void {
  s.played++;
  s.goalsFor += e.goalsFor;
  s.goalsAgainst += e.goalsAgainst;
  if (e.outcome === 'W') {
    s.won++;
    s.points += pw;
  } else if (e.outcome === 'D') {
    s.drawn++;
    s.points += pd;
  } else s.lost++;
  if (e.goalsAgainst === 0) s.cleanSheets++;
  if (e.goalsFor === 0) s.failedToScore++;
}

function emptySplit(): SplitStats {
  return { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, cleanSheets: 0, failedToScore: 0 };
}

export interface TeamEventStats {
  /** Máximo goleador del equipo en la temporada (sin autogoles). */
  topScorer: { playerId: number; name: string; goals: number } | null;
  redCards: number;
  yellowCards: number;
  /** Goles a favor por tiempo (los de minuto desconocido no se cuentan en ninguno). */
  goalsFirstHalf: number;
  goalsSecondHalf: number;
}

/** Estadísticas que salen del detalle de eventos: goleador, tarjetas y goles por tiempo. */
export function teamEventStats(
  teamId: number,
  matches: StatMatch[],
  events: StatEvent[],
  players: Map<number, StatPlayer>,
  options: { until?: string } = {},
): TeamEventStats {
  const counted = new Set(
    matches.filter((m) => isFinished(m) && (m.homeTeamId === teamId || m.awayTeamId === teamId) && (!options.until || m.kickoffUtc < options.until)).map((m) => m.id),
  );
  const goalsBy = new Map<number, number>();
  const stats: TeamEventStats = { topScorer: null, redCards: 0, yellowCards: 0, goalsFirstHalf: 0, goalsSecondHalf: 0 };
  for (const e of events) {
    if (!counted.has(e.matchId) || e.teamId !== teamId) continue;
    if (e.kind === 'red_card') stats.redCards++;
    else if (e.kind === 'yellow_card') stats.yellowCards++;
    else {
      if (e.minute !== null) {
        if (e.minute <= 45) stats.goalsFirstHalf++;
        else stats.goalsSecondHalf++;
      }
      if (e.kind !== 'own_goal' && e.playerId !== null) goalsBy.set(e.playerId, (goalsBy.get(e.playerId) ?? 0) + 1);
    }
  }
  for (const [playerId, goals] of goalsBy) {
    const name = players.get(playerId)?.name ?? `Jugador #${playerId}`;
    const best = stats.topScorer;
    if (!best || goals > best.goals || (goals === best.goals && name.localeCompare(best.name, 'es') < 0)) stats.topScorer = { playerId, name, goals };
  }
  return stats;
}
