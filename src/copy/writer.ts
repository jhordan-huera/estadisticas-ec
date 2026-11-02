// Redactor de textos: arma el pie de cada publicación a partir de su modelo de vista,
// con plantillas propias, variantes deterministas y reglas por situación. Sin IA.

import type { CopyConfig, TeamOverride } from '../core/config.ts';
import type {
  AnyView,
  FixturesView,
  HeadToHeadView,
  ResultView,
  ScorersView,
  StandingsView,
  SummaryView,
  TeamStatsView,
  ViewContext,
} from '../content/views.ts';
import type { TeamVisual } from '../design/components/team.ts';
import type { Outcome, StatMatch } from '../stats/types.ts';
import { hashtagsFor, teamHashtagMap } from './hashtags.ts';
import {
  FIXTURES_HEADLINES,
  H2H_FIRST_MEETING,
  H2H_HEADLINES,
  RESULT_FACTS,
  RESULT_HEADLINES,
  SCORERS_HEADLINES,
  SCORERS_SHARED,
  STANDINGS_HEADLINES,
  STANDINGS_LEADER,
  STANDINGS_NEW_LEADER,
  SUMMARY_HEADLINES,
  SUMMARY_NO_GOALS,
  TEAM_HEADLINES,
} from './phrases.ts';
import { analyzeResult } from './rules.ts';
import { pickAndFill } from './variants.ts';

export interface Caption {
  text: string;
  hashtags: string[];
  /** Descripción de la imagen para accesibilidad. */
  altText: string;
  /** Situación detectada (para depurar y para el planificador). */
  situation: string;
}

export interface CopyContext {
  view: ViewContext;
  config: CopyConfig;
  disclaimer: string;
  teamOverrides: Record<string, TeamOverride>;
}

export function seedFor(view: AnyView): string {
  switch (view.kind) {
    case 'cartelera':
      return `${view.kind}:${view.matchday.stageId}:${view.matchday.round}`;
    case 'resumen':
      return `${view.kind}:${view.summary.matchday.stageId}:${view.summary.matchday.round}`;
    case 'resultado':
    case 'duelo':
      return `${view.kind}:${view.match.id}`;
    case 'tabla':
    case 'goleadores':
      return `${view.kind}:${view.fingerprint}`;
    case 'equipo':
      return `${view.kind}:${view.team.id}:${view.profile.total.played}`;
  }
}

export function writeCaption(view: AnyView, ctx: CopyContext): Caption {
  const seed = seedFor(view);
  let body: { lines: string[]; teams: TeamVisual[]; alt: string; situation: string };
  switch (view.kind) {
    case 'cartelera':
      body = fixtures(view, seed);
      break;
    case 'resultado':
      body = result(view, ctx, seed);
      break;
    case 'resumen':
      body = summary(view, seed);
      break;
    case 'tabla':
      body = standings(view, seed);
      break;
    case 'goleadores':
      body = scorers(view, seed);
      break;
    case 'equipo':
      body = team(view, seed);
      break;
    case 'duelo':
      body = h2h(view, seed);
      break;
  }
  const hashtags = hashtagsFor(view.kind, body.teams, ctx.config.hashtags, teamHashtagMap(ctx.teamOverrides));
  const closing = [ctx.config.fuente, ctx.disclaimer].filter(Boolean).join(' · ');
  const text = [...body.lines, '', closing, '', hashtags.join(' ')].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, hashtags, altText: body.alt, situation: body.situation };
}

// ── Por tipo ──────────────────────────────────────────────────────────────

function fixtures(view: FixturesView, seed: string) {
  const fecha = view.matchday.label.toLowerCase().startsWith('fecha') ? view.matchday.label.replace('Fecha', 'fecha') : view.matchday.label;
  const lines = [pickAndFill(FIXTURES_HEADLINES, seed, { fecha }), view.kicker, ''];
  const teams: TeamVisual[] = [];
  for (const day of view.days) {
    lines.push(capitalize(day.label));
    for (const item of day.items) {
      teams.push(item.home, item.away);
      const where = [item.venue, item.group].filter(Boolean).join(' · ');
      const status = item.status === 'postponed' ? ' (aplazado)' : item.status === 'finished' ? ' (jugado)' : '';
      lines.push(`• ${item.time} ${item.home.shortName} vs ${item.away.shortName}${where ? ` — ${where}` : ''}${status}`);
    }
    lines.push('');
  }
  lines.push('Horarios de Ecuador (UTC-5).');
  const count = view.days.reduce((n, d) => n + d.items.length, 0);
  return { lines, teams, situation: 'cartelera', alt: `Cartelera de la ${fecha}: ${count} partidos con día, hora y estadio.` };
}

function result(view: ResultView, ctx: CopyContext, seed: string) {
  const analysis = analyzeResult(view, ctx.view);
  const headline = pickAndFill(RESULT_HEADLINES[analysis.situation], seed, analysis.vars);
  const lines = [`⚽ ${headline}`, [view.kicker, view.group].filter(Boolean).join(' · '), ''];

  for (const side of [view.home, view.away]) {
    const scorers = view.facts.scorers.filter((s) => s.teamId === side.id);
    if (scorers.length) lines.push(`${side.abbr}: ${scorers.map((s) => `${s.name} ${s.minutes.join(', ')}`).join(' · ')}`);
  }
  if (!view.facts.detailComplete) lines.push('(La fuente no detalla todos los goles de este partido.)');

  const factLines = analysis.facts.slice(0, 3).map((f, i) => `• ${pickAndFill(RESULT_FACTS[f.fact], `${seed}:${f.fact}:${i}`, f.vars)}`);
  if (factLines.length) lines.push('', ...factLines);

  if (view.homeStanding && view.awayStanding) {
    lines.push('', `📊 ${view.home.shortName}: ${view.homeStanding.rank}º (${view.homeStanding.points} pts) · ${view.away.shortName}: ${view.awayStanding.rank}º (${view.awayStanding.points} pts)`);
  }
  const alt = `Resultado final: ${view.home.shortName} ${view.homeScore}, ${view.away.shortName} ${view.awayScore}.` + (view.facts.scorers.length ? ` Goles: ${view.facts.scorers.map((s) => `${s.name} ${s.minutes.join(', ')}`).join('; ')}.` : '');
  return { lines, teams: [view.home, view.away], situation: [analysis.situation, ...analysis.facts.map((f) => f.fact)].join('+'), alt };
}

function summary(view: SummaryView, seed: string) {
  const s = view.summary;
  const fecha = s.matchday.label.replace('Fecha', 'fecha');
  const vars = { fecha, goles: s.goals, partidos: s.finished.length, promedio: s.averageGoals.toFixed(2).replace('.', ',') };
  const headline = s.goals === 0 ? pickAndFill(SUMMARY_NO_GOALS, seed, vars) : pickAndFill(SUMMARY_HEADLINES, seed, vars);
  const abbr = (m: StatMatch, r: SummaryView['results'][number]) => `${r.home.abbr} ${m.homeScore}-${m.awayScore} ${r.away.abbr}`;
  const lines = [headline, view.kicker, ''];
  const pending: string[] = [];
  for (const r of view.results) {
    if (r.pending) pending.push(`${r.home.shortName} vs ${r.away.shortName}`);
    else lines.push(`• ${abbr(r.match, r)}`);
  }
  const find = (m: StatMatch | null) => (m ? view.results.find((r) => r.match.id === m.id) : undefined);
  const big = find(s.biggestWin);
  const most = find(s.highestScoring);
  lines.push('');
  if (big) lines.push(`💥 Mayor goleada: ${abbr(big.match, big)}`);
  if (most && most.match.id !== big?.match.id) lines.push(`🔥 Partido con más goles: ${abbr(most.match, most)}`);
  lines.push(`🏠 Local ${s.homeWins} · 🤝 Empates ${s.draws} · ✈️ Visita ${s.awayWins}`);
  if (pending.length) lines.push(`⏳ Pendiente${pending.length > 1 ? 's' : ''}: ${pending.join(', ')}`);
  return {
    lines,
    teams: [],
    situation: 'resumen',
    alt: `Resumen de la ${fecha}: ${view.results.filter((r) => !r.pending).map((r) => abbr(r.match, r)).join(', ')}.`,
  };
}

function standings(view: StandingsView, seed: string) {
  const contexto = view.kicker.startsWith('Tras') ? ` ${view.kicker.charAt(0).toLowerCase()}${view.kicker.slice(1)}` : view.kicker.startsWith('Actualizada') ? ` (${view.kicker.toLowerCase()})` : '';
  const lines = [pickAndFill(STANDINGS_HEADLINES, seed, { contexto }), ''];
  const teams: TeamVisual[] = [];
  for (const [i, t] of view.tables.entries()) {
    const [first, second] = t.rows;
    if (!first) continue;
    teams.push(first.team);
    const ventaja = second ? (first.points > second.points ? ` (+${first.points - second.points} sobre ${second.team.shortName})` : ` (igualado con ${second.team.shortName})`) : '';
    lines.push(pickAndFill(STANDINGS_LEADER, `${seed}:${i}`, { tabla: t.label, lider: first.team.shortName, pts: first.points, ventaja }));
    if (first.movement > 0) lines.push(pickAndFill(STANDINGS_NEW_LEADER, `${seed}:nuevo:${i}`, { tabla: t.label, lider: first.team.shortName }));
  }
  const movers = view.tables
    .flatMap((t) => t.rows)
    .filter((r) => Math.abs(r.movement) >= 2)
    .sort((a, b) => Math.abs(b.movement) - Math.abs(a.movement))
    .slice(0, 3);
  if (movers.length) {
    lines.push('');
    for (const r of movers) lines.push(`${r.movement > 0 ? '⬆️' : '⬇️'} ${r.team.shortName} ${r.movement > 0 ? 'sube' : 'baja'} ${Math.abs(r.movement)} puestos (${r.position}º)`);
  }
  return {
    lines,
    teams,
    situation: view.tables.some((t) => (t.rows[0]?.movement ?? 0) > 0) ? 'tabla+lider_nuevo' : 'tabla',
    alt: `Tabla de posiciones. ${view.tables.map((t) => `${t.label}: ${t.rows.map((r) => `${r.position}. ${r.team.shortName} ${r.points}`).join(', ')}`).join('. ')}.`,
  };
}

function scorers(view: ScorersView, seed: string) {
  const leaders = view.rows.filter((r) => r.position === 1);
  const first = view.rows[0];
  const lines: string[] = [];
  if (!first) return { lines: ['Todavía no hay goles registrados.'], teams: [], situation: 'goleadores', alt: 'Tabla de goleadores vacía.' };
  lines.push(
    leaders.length > 1
      ? pickAndFill(SCORERS_SHARED, seed, { lideres: joinNames(leaders.map((l) => `${l.name} (${l.team.abbr})`)), n: first.goals })
      : pickAndFill(SCORERS_HEADLINES, seed, { lider: first.name, equipo: first.team.shortName, n: first.goals }),
    '',
  );
  for (const r of view.rows) lines.push(`${r.position}. ${r.name} (${r.team.abbr}) — ${r.goals}${r.penalties ? ` (${r.penalties} de penal)` : ''}`);
  if (view.tiedOutside) lines.push(`…y ${view.tiedOutside} más con ${view.rows.at(-1)!.goals}.`);
  if (view.unattributedGoals) lines.push('', `Nota: ${view.unattributedGoals} gol${view.unattributedGoals > 1 ? 'es' : ''} sin autor registrado en la fuente.`);
  return {
    lines,
    teams: leaders.map((l) => l.team),
    situation: leaders.length > 1 ? 'goleadores+empate' : 'goleadores',
    alt: `Top ${view.rows.length} de goleadores: ${view.rows.map((r) => `${r.name} ${r.goals}`).join(', ')}.`,
  };
}

function team(view: TeamStatsView, seed: string) {
  const p = view.profile;
  const rec = (s: typeof p.total) => `${s.won}G ${s.drawn}E ${s.lost}P`;
  const lines = [
    pickAndFill(TEAM_HEADLINES, seed, { equipo: view.team.name }),
    view.position ? `${view.position.rank}º en ${view.position.table} con ${view.position.points} puntos.` : '',
    '',
    `• Total: ${rec(p.total)} · ${p.total.goalsFor} goles a favor, ${p.total.goalsAgainst} en contra`,
    `• De local: ${rec(p.home)} (${p.home.points} pts) · De visita: ${rec(p.away)} (${p.away.points} pts)`,
    `• Vallas invictas: ${p.total.cleanSheets} · Partidos sin marcar: ${p.total.failedToScore}`,
    `• Últimos 5: ${formLetters(view.last5.map((e) => e.outcome))}`,
  ];
  const streak = describeStreak(p.streaks);
  if (streak) lines.push(`• ${streak}`);
  return {
    lines,
    teams: [view.team],
    situation: 'equipo',
    alt: `Estadísticas de ${view.team.name}: ${rec(p.total)}, ${p.total.goalsFor} goles a favor y ${p.total.goalsAgainst} en contra, ${p.total.cleanSheets} vallas invictas.`,
  };
}

function h2h(view: HeadToHeadView, seed: string) {
  const h = view.h2h;
  const where = [view.venue, view.city].filter(Boolean).join(', ');
  const lines = [
    pickAndFill(H2H_HEADLINES, seed, { local: view.home.shortName, visita: view.away.shortName }),
    `📅 ${capitalize(view.dateLabel)} · ${view.time}${where ? ` · ${where}` : ''}`,
    view.kicker,
    '',
    '📊 Cómo llegan',
  ];
  for (const s of [view.homeSide, view.awaySide]) {
    const pos = s.rankLabel ? `${s.rankLabel.replace(' · ', ' del ')} · ` : '';
    const pts = s.points !== undefined ? `${s.points} pts · ` : '';
    lines.push(`• ${s.team.shortName}: ${pos}${pts}${s.record} · últimos 5: ${formLetters(s.profile.last5.map((e) => e.outcome))}${s.streak ? ` (${s.streak})` : ''}`);
  }
  const hs = view.homeSide.profile.home;
  const as = view.awaySide.profile.away;
  lines.push(`• ${view.home.shortName} de local: ${hs.won}G ${hs.drawn}E ${hs.lost}P · ${view.away.shortName} de visita: ${as.won}G ${as.drawn}E ${as.lost}P`);
  const scorer = (s: typeof view.homeSide) => (s.stats.topScorer ? `${s.stats.topScorer.name} (${s.stats.topScorer.goals})` : undefined);
  const scorers = [scorer(view.homeSide), scorer(view.awaySide)].filter(Boolean);
  if (scorers.length) lines.push(`• Goleadores: ${scorers.join(' · ')}`);

  lines.push('');
  if (h.played.length === 0) lines.push(`🤝 ${pickAndFill(H2H_FIRST_MEETING, seed, {})}`);
  else {
    lines.push(`🤝 Duelos del año: ${h.winsA} victoria${h.winsA === 1 ? '' : 's'} de ${view.home.shortName}, ${h.draws} empate${h.draws === 1 ? '' : 's'} y ${h.winsB} de ${view.away.shortName} (goles ${h.goalsA}-${h.goalsB}).`);
    for (const p of view.previous) lines.push(`• ${p.date}: ${p.home.shortName} ${p.match.homeScore}-${p.match.awayScore} ${p.away.shortName}`);
  }
  lines.push('', 'Desliza para ver la comparativa completa ➡️');
  return {
    lines,
    teams: [view.home, view.away],
    situation: h.played.length ? 'duelo' : 'duelo+primer_cruce',
    alt: `Previa en ${h.played.length ? 3 : 2} imágenes de ${view.home.shortName} contra ${view.away.shortName}, ${view.dateLabel} a las ${view.time}: posiciones, forma, comparativa de la temporada${h.played.length ? ` e historial (${h.winsA}-${h.draws}-${h.winsB})` : ''}.`,
  };
}

// ── Utilidades ────────────────────────────────────────────────────────────

const LETTER: Record<Outcome, string> = { W: 'G', D: 'E', L: 'P' };

function formLetters(outcomes: Outcome[]): string {
  return outcomes.length ? outcomes.map((o) => LETTER[o]).join('') : '—';
}

function describeStreak(s: { wins: number; unbeaten: number; losses: number; winless: number }): string | undefined {
  if (s.wins >= 3) return `Racha: ${s.wins} victorias seguidas`;
  if (s.unbeaten >= 5) return `Racha: ${s.unbeaten} partidos sin perder`;
  if (s.losses >= 3) return `Racha: ${s.losses} derrotas seguidas`;
  if (s.winless >= 5) return `Racha: ${s.winless} partidos sin ganar`;
  return undefined;
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
