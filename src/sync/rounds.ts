// Inferencia de jornadas ("fechas") cuando la fuente no las entrega (caso de ESPN).
//
// Regla: en una fase de liga cada equipo juega una sola vez por jornada. Se recorren
// los partidos en orden cronológico y cada uno se asigna a la primera jornada en la
// que ninguno de sus dos equipos haya jugado todavía. Un partido aplazado cae así en
// su jornada original aunque se juegue semanas después. Las correcciones manuales
// (round_overrides) se fijan antes y la inferencia las respeta.
//
// Validado con la Serie A 2026: 240 partidos → 30 jornadas exactas de 8 partidos.

export interface RoundCandidate {
  id: number;
  kickoffUtc: string;
  homeTeamId: number;
  awayTeamId: number;
}

export interface RoundOutlier {
  matchId: number;
  round: number;
  daysFromRoundMedian: number;
}

export interface RoundAssignment {
  rounds: Map<number, number>;
  /** Partidos lejos de la fecha típica de su jornada (aplazados o reprogramados). */
  outliers: RoundOutlier[];
}

const OUTLIER_DAYS = 10;

export function inferRounds(matches: RoundCandidate[], fixed: Map<number, number> = new Map()): RoundAssignment {
  const busy = new Map<number, Set<number>>();
  const mark = (team: number, round: number) => {
    let s = busy.get(team);
    if (!s) busy.set(team, (s = new Set()));
    s.add(round);
  };
  const isFree = (team: number, round: number) => !busy.get(team)?.has(round);

  const rounds = new Map<number, number>();
  for (const m of matches) {
    const r = fixed.get(m.id);
    if (r === undefined) continue;
    rounds.set(m.id, r);
    mark(m.homeTeamId, r);
    mark(m.awayTeamId, r);
  }

  const pending = matches
    .filter((m) => !fixed.has(m.id))
    .sort((a, b) => (a.kickoffUtc < b.kickoffUtc ? -1 : a.kickoffUtc > b.kickoffUtc ? 1 : a.id - b.id));
  for (const m of pending) {
    let r = 1;
    while (!isFree(m.homeTeamId, r) || !isFree(m.awayTeamId, r)) r++;
    rounds.set(m.id, r);
    mark(m.homeTeamId, r);
    mark(m.awayTeamId, r);
  }

  return { rounds, outliers: findOutliers(matches, rounds) };
}

function findOutliers(matches: RoundCandidate[], rounds: Map<number, number>): RoundOutlier[] {
  const byRound = new Map<number, RoundCandidate[]>();
  for (const m of matches) {
    const r = rounds.get(m.id)!;
    let list = byRound.get(r);
    if (!list) byRound.set(r, (list = []));
    list.push(m);
  }
  const outliers: RoundOutlier[] = [];
  for (const [round, list] of byRound) {
    const times = list.map((m) => Date.parse(m.kickoffUtc)).sort((a, b) => a - b);
    // Mediana inferior: los reprogramados suelen jugarse después, no deben arrastrar la referencia.
    const median = times[Math.floor((times.length - 1) / 2)]!;
    for (const m of list) {
      const days = Math.round((Date.parse(m.kickoffUtc) - median) / 86_400_000);
      if (Math.abs(days) >= OUTLIER_DAYS) outliers.push({ matchId: m.id, round, daysFromRoundMedian: days });
    }
  }
  return outliers;
}
