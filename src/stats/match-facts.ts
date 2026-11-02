// Hechos de un partido que usan el redactor y los diseños: goleadores agrupados,
// expulsiones, goleada, remontada y gol decisivo en el final.

import type { StatEvent, StatMatch, StatPlayer } from './types.ts';

export interface ScorerLine {
  teamId: number;
  playerId: number | null;
  name: string;
  /** "12'", "45+2' (p)", "80' (ag)" */
  minutes: string[];
}

export interface CardLine {
  teamId: number;
  playerId: number | null;
  name: string;
  minute: string;
}

export interface MatchFacts {
  matchId: number;
  winnerId: number | null;
  loserId: number | null;
  margin: number;
  totalGoals: number;
  isRout: boolean;
  isGoallessDraw: boolean;
  isHighScoring: boolean;
  /** Equipo que ganó tras ir perdiendo, y por cuántos goles llegó a ir abajo. */
  comeback: { teamId: number; deficit: number } | null;
  /** Equipo que empató tras ir perdiendo. */
  rescuedDraw: { teamId: number; deficit: number } | null;
  /** Gol que dio la ventaja definitiva al ganador, si fue en el minuto 85 o después. */
  lateWinner: { teamId: number; minuteLabel: string; name: string } | null;
  scorers: ScorerLine[];
  redCards: CardLine[];
  /** false si los goles con detalle no cuadran con el marcador. */
  detailComplete: boolean;
}

export const ROUT_MARGIN = 3;
const HIGH_SCORING_TOTAL = 5;
const LATE_MINUTE = 85;

export function matchFacts(match: StatMatch, events: StatEvent[], players: Map<number, StatPlayer>): MatchFacts {
  const hs = match.homeScore ?? 0;
  const as = match.awayScore ?? 0;
  const winnerId = hs > as ? match.homeTeamId : as > hs ? match.awayTeamId : null;
  const loserId = winnerId === null ? null : winnerId === match.homeTeamId ? match.awayTeamId : match.homeTeamId;
  const own = events.filter((e) => e.matchId === match.id).sort(chronological);
  const goals = own.filter((e) => e.kind === 'goal' || e.kind === 'penalty_goal' || e.kind === 'own_goal');
  const nameOf = (id: number | null) => (id === null ? 'Sin autor registrado' : (players.get(id)?.shortName ?? players.get(id)?.name ?? `#${id}`));

  const scorers: ScorerLine[] = [];
  for (const g of goals) {
    const suffix = g.kind === 'penalty_goal' ? ' (p)' : g.kind === 'own_goal' ? ' (ag)' : '';
    const key = (s: ScorerLine) => s.teamId === g.teamId && s.playerId === g.playerId && g.playerId !== null;
    const line = scorers.find(key);
    if (line) line.minutes.push(g.minuteLabel + suffix);
    else scorers.push({ teamId: g.teamId, playerId: g.playerId, name: nameOf(g.playerId), minutes: [g.minuteLabel + suffix] });
  }
  const redCards = own
    .filter((e) => e.kind === 'red_card')
    .map((e) => ({ teamId: e.teamId, playerId: e.playerId, name: e.playerId === null ? 'Sin jugador identificado' : nameOf(e.playerId), minute: e.minuteLabel }));

  const detailComplete = goals.filter((g) => g.teamId === match.homeTeamId).length === hs && goals.filter((g) => g.teamId === match.awayTeamId).length === as;

  // Recorrido del marcador gol a gol (solo es fiable si el detalle está completo).
  let comeback: MatchFacts['comeback'] = null;
  let rescuedDraw: MatchFacts['rescuedDraw'] = null;
  let lateWinner: MatchFacts['lateWinner'] = null;
  if (detailComplete && goals.length > 0) {
    let h = 0;
    let a = 0;
    let worstHome = 0; // peor diferencia vista por el local
    let worstAway = 0;
    let decisive: StatEvent | null = null;
    for (const g of goals) {
      const homeBefore = h - a;
      if (g.teamId === match.homeTeamId) h++;
      else a++;
      worstHome = Math.min(worstHome, h - a);
      worstAway = Math.min(worstAway, a - h);
      // El gol decisivo es el que pone al ganador por delante por última vez.
      if (winnerId === match.homeTeamId && homeBefore === 0 && h - a === 1) decisive = g;
      if (winnerId === match.awayTeamId && homeBefore === 0 && a - h === 1) decisive = g;
    }
    if (winnerId === match.homeTeamId && worstHome < 0) comeback = { teamId: winnerId, deficit: -worstHome };
    if (winnerId === match.awayTeamId && worstAway < 0) comeback = { teamId: winnerId, deficit: -worstAway };
    if (winnerId === null && hs > 0) {
      if (worstHome < 0) rescuedDraw = { teamId: match.homeTeamId, deficit: -worstHome };
      else if (worstAway < 0) rescuedDraw = { teamId: match.awayTeamId, deficit: -worstAway };
    }
    if (decisive && winnerId !== null && (decisive.minute ?? 0) >= LATE_MINUTE) {
      lateWinner = { teamId: winnerId, minuteLabel: decisive.minuteLabel, name: nameOf(decisive.playerId) };
    }
  }

  return {
    matchId: match.id,
    winnerId,
    loserId,
    margin: Math.abs(hs - as),
    totalGoals: hs + as,
    isRout: Math.abs(hs - as) >= ROUT_MARGIN,
    isGoallessDraw: match.status === 'finished' && hs === 0 && as === 0,
    isHighScoring: hs + as >= HIGH_SCORING_TOTAL,
    comeback,
    rescuedDraw,
    lateWinner,
    scorers,
    redCards,
    detailComplete,
  };
}

function chronological(a: StatEvent, b: StatEvent): number {
  return (a.minute ?? 0) - (b.minute ?? 0) || (a.addedTime ?? 0) - (b.addedTime ?? 0) || a.seq - b.seq;
}
