// Duelos directos entre dos equipos en la temporada, para la previa de un partido.

import { byKickoff, isFinished, type StatMatch } from './types.ts';

export interface HeadToHead {
  teamA: number;
  teamB: number;
  /** Partidos ya jugados entre ambos, del más antiguo al más reciente. */
  played: StatMatch[];
  winsA: number;
  winsB: number;
  draws: number;
  goalsA: number;
  goalsB: number;
  /** Próximo cruce programado (si existe). */
  next: StatMatch | null;
}

export function headToHead(teamA: number, teamB: number, matches: StatMatch[], options: { before?: string } = {}): HeadToHead {
  const between = matches
    .filter(
      (m) =>
        m.status !== 'cancelled' &&
        ((m.homeTeamId === teamA && m.awayTeamId === teamB) || (m.homeTeamId === teamB && m.awayTeamId === teamA)),
    )
    .sort(byKickoff);

  const result: HeadToHead = { teamA, teamB, played: [], winsA: 0, winsB: 0, draws: 0, goalsA: 0, goalsB: 0, next: null };
  for (const m of between) {
    if (isFinished(m) && (!options.before || m.kickoffUtc < options.before)) {
      result.played.push(m);
      const a = m.homeTeamId === teamA ? m.homeScore : m.awayScore;
      const b = m.homeTeamId === teamA ? m.awayScore : m.homeScore;
      result.goalsA += a;
      result.goalsB += b;
      if (a > b) result.winsA++;
      else if (b > a) result.winsB++;
      else result.draws++;
    } else if (!isFinished(m) && !result.next && (m.status === 'scheduled' || m.status === 'postponed')) {
      result.next = m;
    }
  }
  return result;
}
