// Tablas de la temporada: general (todos los equipos, toda la temporada) y, en la
// fase de grupos, una por grupo. Con "acumulados" la tabla de grupo arrastra los
// puntos de la primera fase; con "reiniciados" solo cuenta la fase de grupos.

import type { TableRules } from '../core/config.ts';
import { computeStandings, positionChanges, type StandingRow } from './standings.ts';
import type { SeasonData, StatGroup, StatMatch } from './types.ts';

export interface GroupTable {
  group: StatGroup;
  rows: StandingRow[];
}

export interface SeasonTables {
  overall: StandingRow[];
  groups: GroupTable[];
  /** Tablas "vigentes": las de grupo si la fase de grupos ya empezó, si no la general. */
  current: { label: string; rows: StandingRow[] }[];
}

export function leagueMatches(data: SeasonData): StatMatch[] {
  const ids = new Set(data.stages.filter((s) => s.kind !== 'knockout').map((s) => s.id));
  return data.matches.filter((m) => ids.has(m.stageId));
}

export function seasonTables(data: SeasonData, rules: TableRules, options: { until?: string } = {}): SeasonTables {
  const matches = leagueMatches(data);
  const names = new Map([...data.teams.values()].map((t) => [t.id, t.name]));
  const teamIds = new Set<number>();
  for (const m of matches) {
    teamIds.add(m.homeTeamId);
    teamIds.add(m.awayTeamId);
  }
  const common = { rules, teamNames: names, adjustments: data.adjustments, until: options.until };
  const overall = computeStandings(matches, { ...common, teamIds });

  const groups: GroupTable[] = data.groups.map((group) => {
    const pool = rules.puntosFaseFinal === 'acumulados' ? matches : matches.filter((m) => m.stageId === group.stageId);
    return { group, rows: computeStandings(pool, { ...common, teamIds: group.teamIds }) };
  });

  const groupStageStarted = data.groups.some((g) =>
    matches.some((m) => m.stageId === g.stageId && m.status === 'finished' && (!options.until || m.kickoffUtc < options.until)),
  );
  const current = groupStageStarted && groups.length > 0 ? groups.map((g) => ({ label: g.group.name, rows: g.rows })) : [{ label: 'Tabla general', rows: overall }];
  return { overall, groups, current };
}

/** Variación de puesto de cada equipo respecto de la tabla antes de `since`. */
export function tableMovement(data: SeasonData, rules: TableRules, since: string): Map<number, number> {
  const now = seasonTables(data, rules);
  const before = seasonTables(data, rules, { until: since });
  const result = new Map<number, number>();
  const pairs = now.groups.length ? now.groups.map((g, i) => [g.rows, before.groups[i]!.rows] as const) : [[now.overall, before.overall] as const];
  for (const [cur, prev] of pairs) for (const [team, delta] of positionChanges(cur, prev)) result.set(team, delta);
  return result;
}
