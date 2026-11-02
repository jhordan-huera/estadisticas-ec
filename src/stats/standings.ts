// Tabla de posiciones calculada a partir de los partidos finalizados.
// Los criterios de desempate se aplican en cadena: cada criterio solo ordena a los
// equipos que siguen empatados tras los anteriores. "enfrentamientos" arma una
// mini-tabla con los partidos jugados entre los equipos empatados.

import type { TableRules, Tiebreaker } from '../core/config.ts';
import { byKickoff, isFinished, outcomeFor, type Outcome, type PointAdjustment, type StatMatch } from './types.ts';

export interface StandingRow {
  position: number;
  teamId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  awayGoals: number;
  adjustment: number;
  points: number;
  /** Últimos 5 resultados, del más antiguo al más reciente. */
  form: Outcome[];
}

export interface StandingsOptions {
  teamIds: Iterable<number>;
  rules: TableRules;
  teamNames: Map<number, string>;
  adjustments?: PointAdjustment[];
  /** Solo cuenta partidos con inicio anterior a este instante ISO. */
  until?: string;
}

export function computeStandings(matches: StatMatch[], options: StandingsOptions): StandingRow[] {
  const included = new Set(options.teamIds);
  const played = matches
    .filter(isFinished)
    .filter((m) => !options.until || m.kickoffUtc < options.until)
    .sort(byKickoff);

  const rows = new Map<number, StandingRow>();
  for (const teamId of included) rows.set(teamId, emptyRow(teamId));

  for (const m of played) {
    for (const [teamId, isHome] of [
      [m.homeTeamId, true],
      [m.awayTeamId, false],
    ] as const) {
      const row = rows.get(teamId);
      if (!row) continue;
      const gf = isHome ? m.homeScore : m.awayScore;
      const ga = isHome ? m.awayScore : m.homeScore;
      const outcome = outcomeFor(m, teamId);
      row.played++;
      row.goalsFor += gf;
      row.goalsAgainst += ga;
      if (!isHome) row.awayGoals += gf;
      if (outcome === 'W') row.won++;
      else if (outcome === 'D') row.drawn++;
      else row.lost++;
      row.form.push(outcome);
    }
  }

  for (const adj of options.adjustments ?? []) {
    if (options.until && adj.effectiveFrom >= options.until) continue;
    const row = rows.get(adj.teamId);
    if (row) row.adjustment += adj.points;
  }
  for (const row of rows.values()) {
    row.goalDiff = row.goalsFor - row.goalsAgainst;
    row.points = row.won * options.rules.puntosVictoria + row.drawn * options.rules.puntosEmpate + row.adjustment;
    row.form = row.form.slice(-5);
  }

  const ordered = rank([...rows.values()], options.rules.desempate, { played, rules: options.rules, names: options.teamNames });
  ordered.forEach((row, i) => (row.position = i + 1));
  return ordered;
}

/** Diferencia de posición entre dos tablas: positivo = subió. */
export function positionChanges(current: StandingRow[], previous: StandingRow[]): Map<number, number> {
  const before = new Map(previous.map((r) => [r.teamId, r.position]));
  return new Map(current.map((r) => [r.teamId, (before.get(r.teamId) ?? r.position) - r.position]));
}

interface RankContext {
  played: (StatMatch & { homeScore: number; awayScore: number })[];
  rules: TableRules;
  names: Map<number, string>;
}

function rank(rows: StandingRow[], criteria: Tiebreaker[], ctx: RankContext): StandingRow[] {
  if (rows.length <= 1) return rows;
  const [criterion, ...rest] = criteria;
  if (!criterion) return [...rows].sort((a, b) => a.teamId - b.teamId);

  const keyOf = keyFunction(criterion, rows, ctx);
  const buckets = new Map<string | number, StandingRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  const keys = [...buckets.keys()].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number' ? b - a : String(a).localeCompare(String(b), 'es'),
  );
  return keys.flatMap((k) => rank(buckets.get(k)!, rest, ctx));
}

function keyFunction(criterion: Tiebreaker, rows: StandingRow[], ctx: RankContext): (row: StandingRow) => string | number {
  switch (criterion) {
    case 'puntos':
      return (r) => r.points;
    case 'diferencia':
      return (r) => r.goalDiff;
    case 'golesFavor':
      return (r) => r.goalsFor;
    case 'golesVisitante':
      return (r) => r.awayGoals;
    case 'victorias':
      return (r) => r.won;
    case 'alfabetico':
      return (r) => ctx.names.get(r.teamId) ?? String(r.teamId);
    case 'enfrentamientos': {
      const mini = headToHeadMiniTable(rows.map((r) => r.teamId), ctx);
      // Puntos y diferencia del mini-torneo combinados en una sola clave numérica.
      return (r) => {
        const m = mini.get(r.teamId)!;
        return m.points * 10_000 + (m.goalDiff + 5_000);
      };
    }
  }
}

function headToHeadMiniTable(teamIds: number[], ctx: RankContext): Map<number, { points: number; goalDiff: number }> {
  const set = new Set(teamIds);
  const table = new Map(teamIds.map((id) => [id, { points: 0, goalDiff: 0 }]));
  for (const m of ctx.played) {
    if (!set.has(m.homeTeamId) || !set.has(m.awayTeamId)) continue;
    for (const teamId of [m.homeTeamId, m.awayTeamId]) {
      const entry = table.get(teamId)!;
      const outcome = outcomeFor(m, teamId);
      entry.points += outcome === 'W' ? ctx.rules.puntosVictoria : outcome === 'D' ? ctx.rules.puntosEmpate : 0;
      entry.goalDiff += teamId === m.homeTeamId ? m.homeScore - m.awayScore : m.awayScore - m.homeScore;
    }
  }
  return table;
}

function emptyRow(teamId: number): StandingRow {
  return {
    position: 0,
    teamId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    awayGoals: 0,
    adjustment: 0,
    points: 0,
    form: [],
  };
}
