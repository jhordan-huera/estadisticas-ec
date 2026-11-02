// Tabla de goleadores acumulada a partir de los goles de cada partido finalizado.
// No cuenta autogoles. Los goles sin autor se informan aparte, nunca se pierden.

import { isFinished, type StatEvent, type StatMatch, type StatPlayer } from './types.ts';

export interface ScorerRow {
  position: number;
  playerId: number;
  name: string;
  shortName: string;
  /** Equipo con el que marcó su gol más reciente. */
  teamId: number;
  goals: number;
  penalties: number;
  matchesWithGoal: number;
}

export interface ScorersTable {
  rows: ScorerRow[];
  /** Goles del marcador que la fuente no atribuye a ningún jugador. */
  unattributedGoals: number;
  ownGoals: number;
}

export interface ScorersOptions {
  until?: string;
  stageIds?: Set<number>;
}

export function computeScorers(
  matches: StatMatch[],
  events: StatEvent[],
  players: Map<number, StatPlayer>,
  options: ScorersOptions = {},
): ScorersTable {
  const counted = new Map<number, StatMatch>();
  for (const m of matches) {
    if (!isFinished(m)) continue;
    if (options.until && m.kickoffUtc >= options.until) continue;
    if (options.stageIds && !options.stageIds.has(m.stageId)) continue;
    counted.set(m.id, m);
  }

  const acc = new Map<number, { goals: number; penalties: number; matches: Set<number>; teamId: number; lastKickoff: string }>();
  const detailGoalsByMatch = new Map<number, number>();
  let ownGoals = 0;
  let unattributed = 0;

  for (const e of events) {
    const match = counted.get(e.matchId);
    if (!match) continue;
    if (e.kind !== 'goal' && e.kind !== 'penalty_goal' && e.kind !== 'own_goal') continue;
    detailGoalsByMatch.set(e.matchId, (detailGoalsByMatch.get(e.matchId) ?? 0) + 1);
    if (e.kind === 'own_goal') {
      ownGoals++;
      continue;
    }
    if (e.playerId === null) {
      unattributed++;
      continue;
    }
    let entry = acc.get(e.playerId);
    if (!entry) acc.set(e.playerId, (entry = { goals: 0, penalties: 0, matches: new Set(), teamId: e.teamId, lastKickoff: '' }));
    entry.goals++;
    if (e.kind === 'penalty_goal') entry.penalties++;
    entry.matches.add(e.matchId);
    if (match.kickoffUtc >= entry.lastKickoff) {
      entry.lastKickoff = match.kickoffUtc;
      entry.teamId = e.teamId;
    }
  }

  for (const m of counted.values()) {
    const scored = (m.homeScore ?? 0) + (m.awayScore ?? 0);
    unattributed += Math.max(0, scored - (detailGoalsByMatch.get(m.id) ?? 0));
  }

  const rows: ScorerRow[] = [...acc.entries()].map(([playerId, e]) => {
    const p = players.get(playerId);
    return {
      position: 0,
      playerId,
      name: p?.name ?? `Jugador #${playerId}`,
      shortName: p?.shortName ?? p?.name ?? `#${playerId}`,
      teamId: e.teamId,
      goals: e.goals,
      penalties: e.penalties,
      matchesWithGoal: e.matches.size,
    };
  });
  rows.sort((a, b) => b.goals - a.goals || a.penalties - b.penalties || a.name.localeCompare(b.name, 'es'));
  // Misma cantidad de goles = misma posición (1, 2, 2, 4…).
  rows.forEach((r, i) => (r.position = i > 0 && rows[i - 1]!.goals === r.goals ? rows[i - 1]!.position : i + 1));

  return { rows, unattributedGoals: unattributed, ownGoals };
}

/** Corta en `limit` filas e indica cuántos más comparten los goles de la última fila. */
export function topScorers(table: ScorersTable, limit = 10): { rows: ScorerRow[]; tiedOutside: number } {
  const rows = table.rows.slice(0, limit);
  const last = rows.at(-1);
  const tiedOutside = last ? table.rows.slice(limit).filter((r) => r.goals === last.goals).length : 0;
  return { rows, tiedOutside };
}
