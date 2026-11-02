// Reglas de redacción para un resultado: una situación principal (titular) y una lista
// de hechos secundarios ordenados por relevancia. Cada regla es explícita y comprobable.

import type { ResultView, ViewContext } from '../content/views.ts';
import { leagueMatches } from '../stats/season.ts';
import { teamProfile, type Streaks } from '../stats/team.ts';
import type { ResultFact, ResultSituation } from './phrases.ts';
import type { Vars } from './variants.ts';

export interface FactLine {
  fact: ResultFact;
  vars: Vars;
}

export interface ResultAnalysis {
  situation: ResultSituation;
  vars: Vars;
  facts: FactLine[];
}

const STREAK_WINS = 3;
const STREAK_UNBEATEN = 5;
const STREAK_LOSSES = 3;
const DROUGHT = 4;

export function analyzeResult(view: ResultView, ctx: ViewContext): ResultAnalysis {
  const { facts: f, home, away, homeScore, awayScore } = view;
  const name = (id: number) => (id === home.id ? home.shortName : away.shortName);
  const city = view.match.city;
  const winnerScore = Math.max(homeScore, awayScore);
  const loserScore = Math.min(homeScore, awayScore);
  const vars: Vars = {
    local: home.shortName,
    visita: away.shortName,
    marcador: f.winnerId !== null ? `${winnerScore}-${loserScore}` : `${homeScore}-${awayScore}`,
    enCiudad: city ? ` en ${city}` : '',
  };
  if (f.winnerId !== null && f.loserId !== null) {
    vars.ganador = name(f.winnerId);
    vars.perdedor = name(f.loserId);
  }

  let situation: ResultSituation;
  if (f.comeback) {
    situation = 'remontada';
    vars.deficit = f.comeback.deficit === 1 ? 'por un gol' : `por ${f.comeback.deficit} goles`;
  } else if (f.isRout) situation = 'goleada';
  else if (f.isGoallessDraw) situation = 'empate_sin_goles';
  else if (f.winnerId === null && f.rescuedDraw) {
    situation = 'empate_rescatado';
    vars.rescatador = name(f.rescuedDraw.teamId);
    vars.otro = name(f.rescuedDraw.teamId === home.id ? away.id : home.id);
  } else if (f.winnerId === null) situation = 'empate';
  else situation = f.margin === 1 ? 'victoria_ajustada' : 'victoria_clara';

  const facts: FactLine[] = [];
  if (f.lateWinner) facts.push({ fact: 'gol_al_final', vars: { autor: f.lateWinner.name, minuto: f.lateWinner.minuteLabel } });
  if (view.leaderChange) {
    const table = ctx.data.groups.length ? ctx.data.groups.find((g) => g.teamIds.includes(view.leaderChange!.teamId))?.name : undefined;
    facts.push({ fact: 'lider_nuevo', vars: { equipo: name(view.leaderChange.teamId), deTabla: table ? ` del ${table}` : '' } });
  }
  for (const team of [home, away]) facts.push(...streakFacts(team.id, team.shortName, view, ctx));
  if (f.redCards.length) {
    const list = f.redCards.map((c) => `${c.name} (${team(c.teamId, home, away)}, ${c.minute})`).join(', ');
    facts.push({ fact: f.redCards.length > 1 ? 'expulsados_varios' : 'expulsados', vars: { lista: list } });
  }
  if (f.winnerId === away.id && situation !== 'goleada' && situation !== 'remontada') facts.push({ fact: 'victoria_visitante', vars: { equipo: away.shortName } });
  return { situation, vars, facts };
}

function team(id: number, home: { id: number; abbr: string }, away: { abbr: string }): string {
  return id === home.id ? home.abbr : away.abbr;
}

/** Rachas que el partido extiende o corta, comparando antes y después. */
function streakFacts(teamId: number, teamName: string, view: ResultView, ctx: ViewContext): FactLine[] {
  const matches = leagueMatches(ctx.data);
  const kickoff = view.match.kickoffUtc;
  const after = teamProfile(teamId, matches, { until: new Date(Date.parse(kickoff) + 1000).toISOString() }).streaks;
  const before = teamProfile(teamId, matches, { until: kickoff }).streaks;
  return chooseStreak(teamName, before, after);
}

export function chooseStreak(teamName: string, before: Streaks, after: Streaks): FactLine[] {
  if (after.wins >= STREAK_WINS) return [{ fact: 'racha_victorias', vars: { equipo: teamName, n: after.wins } }];
  if (after.wins === 1 && before.winless >= DROUGHT) return [{ fact: 'fin_racha_sin_ganar', vars: { equipo: teamName, n: before.winless } }];
  if (after.unbeaten >= STREAK_UNBEATEN && after.wins < STREAK_WINS) return [{ fact: 'racha_invicto', vars: { equipo: teamName, n: after.unbeaten } }];
  if (after.losses >= STREAK_LOSSES) return [{ fact: 'racha_derrotas', vars: { equipo: teamName, n: after.losses } }];
  return [];
}
