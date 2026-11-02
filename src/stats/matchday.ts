// Fechas (jornadas): agrupación, estado y resumen.
// Un partido reprogramado lejos del resto de su fecha no impide darla por terminada:
// se separa como "pendiente" y la fecha se considera completa con su núcleo jugado.

import { byKickoff, isFinished, type SeasonData, type StatMatch } from './types.ts';

export const RESCHEDULED_DAYS = 10;

export interface Matchday {
  stageId: number;
  stageName: string;
  stageOrder: number;
  round: number;
  label: string;
  /** Todos los partidos de la fecha, en orden cronológico. */
  matches: StatMatch[];
  /** Partidos dentro de la ventana normal de la fecha. */
  core: StatMatch[];
  /** Partidos reprogramados fuera de la ventana. */
  rescheduled: StatMatch[];
  firstKickoff: string;
  lastKickoff: string;
  /** Todos los partidos del núcleo terminaron (o se cancelaron). */
  complete: boolean;
  finishedCount: number;
}

export function matchdays(data: SeasonData): Matchday[] {
  const groups = new Map<string, StatMatch[]>();
  for (const m of data.matches) {
    if (m.round === null || m.status === 'cancelled') continue;
    const key = `${m.stageId}:${m.round}`;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }

  const result: Matchday[] = [];
  for (const list of groups.values()) {
    list.sort(byKickoff);
    const first = list[0]!;
    const stage = data.stages.find((s) => s.id === first.stageId)!;
    const times = list.map((m) => Date.parse(m.kickoffUtc)).sort((a, b) => a - b);
    // Mediana inferior: un reprogramado tardío no debe desplazar la ventana de la fecha.
    const median = times[Math.floor((times.length - 1) / 2)]!;
    const isCore = (m: StatMatch) => Math.abs(Date.parse(m.kickoffUtc) - median) < RESCHEDULED_DAYS * 86_400_000;
    const core = list.filter(isCore);
    const rescheduled = list.filter((m) => !isCore(m));
    result.push({
      stageId: stage.id,
      stageName: stage.name,
      stageOrder: stage.order,
      round: first.round!,
      label: stage.kind === 'knockout' ? (first.roundLabel ?? `Ronda ${first.round}`) : `Fecha ${first.round}`,
      matches: list,
      core,
      rescheduled,
      firstKickoff: core[0]!.kickoffUtc,
      lastKickoff: core.at(-1)!.kickoffUtc,
      complete: core.every((m) => m.status === 'finished'),
      finishedCount: list.filter((m) => m.status === 'finished').length,
    });
  }
  return result.sort((a, b) => a.stageOrder - b.stageOrder || a.round - b.round);
}

/** Última fecha cuyo núcleo ya terminó. */
export function lastCompletedMatchday(days: Matchday[]): Matchday | undefined {
  return days.filter((d) => d.complete).at(-1);
}

/** Próxima fecha con partidos por jugar en su núcleo, a partir de `now`. */
export function nextMatchday(days: Matchday[], now: Date): Matchday | undefined {
  const iso = now.toISOString();
  return days.find((d) => !d.complete && d.core.some((m) => m.status === 'scheduled' && m.kickoffUtc >= iso.slice(0, 10)));
}

export interface MatchdaySummary {
  matchday: Matchday;
  finished: StatMatch[];
  goals: number;
  averageGoals: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  goallessDraws: number;
  biggestWin: StatMatch | null;
  highestScoring: StatMatch | null;
}

export function summarizeMatchday(day: Matchday): MatchdaySummary {
  const finished = day.matches.filter(isFinished);
  let goals = 0;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let goallessDraws = 0;
  let biggestWin: (typeof finished)[number] | null = null;
  let highestScoring: (typeof finished)[number] | null = null;

  for (const m of finished) {
    const total = m.homeScore + m.awayScore;
    const margin = Math.abs(m.homeScore - m.awayScore);
    goals += total;
    if (m.homeScore > m.awayScore) homeWins++;
    else if (m.homeScore < m.awayScore) awayWins++;
    else {
      draws++;
      if (total === 0) goallessDraws++;
    }
    if (margin > 0) {
      const bm = biggestWin ? Math.abs(biggestWin.homeScore - biggestWin.awayScore) : 0;
      const bt = biggestWin ? biggestWin.homeScore + biggestWin.awayScore : 0;
      if (margin > bm || (margin === bm && total > bt)) biggestWin = m;
    }
    if (total > 0) {
      const ht = highestScoring ? highestScoring.homeScore + highestScoring.awayScore : 0;
      const hm = highestScoring ? Math.abs(highestScoring.homeScore - highestScoring.awayScore) : 0;
      if (total > ht || (total === ht && margin < hm)) highestScoring = m;
    }
  }

  return {
    matchday: day,
    finished,
    goals,
    averageGoals: finished.length ? Math.round((goals / finished.length) * 100) / 100 : 0,
    homeWins,
    draws,
    awayWins,
    goallessDraws,
    biggestWin,
    highestScoring,
  };
}
