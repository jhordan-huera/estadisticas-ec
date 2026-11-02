// Modelos de vista: datos ya calculados y listos para dibujar o redactar.
// Los usan tanto las plantillas de imagen como el redactor de textos, de modo que
// imagen y texto de una publicación siempre cuenten exactamente lo mismo.

import type { TableRules } from '../core/config.ts';
import { toLocal, DEFAULT_TIME_ZONE } from '../core/time.ts';
import { contrastRatio, readableOn } from '../design/color.ts';
import { visualFor, type LogoSet, type TeamVisual } from '../design/components/team.ts';
import { headToHead, type HeadToHead } from '../stats/head-to-head.ts';
import { matchFacts, type MatchFacts } from '../stats/match-facts.ts';
import { summarizeMatchday, type Matchday, type MatchdaySummary } from '../stats/matchday.ts';
import { computeScorers, topScorers, type ScorerRow } from '../stats/scorers.ts';
import { leagueMatches, seasonTables, tableMovement } from '../stats/season.ts';
import type { StandingRow } from '../stats/standings.ts';
import { teamEventStats, teamProfile, type TeamEventStats, type TeamProfile } from '../stats/team.ts';
import type { SeasonData, StatLineup, StatLineupPlayer, StatMatch } from '../stats/types.ts';
import { lineupRows } from '../stats/lineup-layout.ts';

export interface ViewContext {
  data: SeasonData;
  visuals: Map<number, TeamVisual>;
  rules: TableRules;
  timeZone: string;
}

export function createViewContext(data: SeasonData, rules: TableRules, logos: Map<string, LogoSet> = new Map(), timeZone = DEFAULT_TIME_ZONE): ViewContext {
  const visuals = new Map<number, TeamVisual>();
  for (const t of data.teams.values()) visuals.set(t.id, visualFor(t, logos.get(t.abbr.toUpperCase())));
  return { data, visuals, rules, timeZone };
}

export function competitionLabel(ctx: ViewContext): string {
  return `${ctx.data.competitionName} ${ctx.data.year}`;
}

/** "Fase final · Fecha 5", o solo "Fecha 5" si la temporada tiene una única fase. */
export function matchdayKicker(ctx: ViewContext, day: Matchday): string {
  const leagueStages = ctx.data.stages.filter((s) => s.kind !== 'knockout').length;
  return leagueStages > 1 || ctx.data.stages.find((s) => s.id === day.stageId)?.kind === 'knockout' ? `${day.stageName} · ${day.label}` : day.label;
}

function groupName(ctx: ViewContext, m: StatMatch): string | undefined {
  return m.groupId !== null ? ctx.data.groups.find((g) => g.id === m.groupId)?.name : undefined;
}

// ── Cartelera ──────────────────────────────────────────────────────────────

export interface FixtureItem {
  matchId: number;
  home: TeamVisual;
  away: TeamVisual;
  time: string;
  venue?: string;
  city?: string;
  group?: string;
  status: StatMatch['status'];
}

export interface FixturesView {
  kind: 'cartelera';
  competition: string;
  kicker: string;
  matchday: Matchday;
  days: { date: string; label: string; items: FixtureItem[] }[];
}

export function fixturesView(ctx: ViewContext, day: Matchday): FixturesView {
  const days: FixturesView['days'] = [];
  for (const m of day.matches) {
    const local = toLocal(m.kickoffUtc, ctx.timeZone);
    let bucket = days.find((d) => d.date === local.date);
    if (!bucket) days.push((bucket = { date: local.date, label: `${local.weekday} ${local.dayMonth}`, items: [] }));
    bucket.items.push({
      matchId: m.id,
      home: ctx.visuals.get(m.homeTeamId)!,
      away: ctx.visuals.get(m.awayTeamId)!,
      time: local.time,
      venue: m.venue ?? undefined,
      city: m.city ?? undefined,
      group: groupName(ctx, m),
      status: m.status,
    });
  }
  return { kind: 'cartelera', competition: competitionLabel(ctx), kicker: matchdayKicker(ctx, day), matchday: day, days };
}

// ── Resultado de un partido ───────────────────────────────────────────────

export interface ResultView {
  kind: 'resultado';
  competition: string;
  kicker: string;
  match: StatMatch;
  home: TeamVisual;
  away: TeamVisual;
  homeScore: number;
  awayScore: number;
  facts: MatchFacts;
  dateLabel: string;
  venue?: string;
  group?: string;
  /** Etiquetas de situación para la imagen: "Goleada", "Remontada", … */
  tags: string[];
  /** Posición del líder tras el partido, si cambió (para el texto). */
  leaderChange?: { teamId: number; previousLeaderId: number | null };
  /** Puesto y puntos de cada equipo justo después del partido. */
  homeStanding?: { rank: number; points: number; table: string };
  awayStanding?: { rank: number; points: number; table: string };
}

export function resultView(ctx: ViewContext, match: StatMatch, day?: Matchday): ResultView {
  const facts = matchFacts(match, ctx.data.events, ctx.data.players);
  const local = toLocal(match.kickoffUtc, ctx.timeZone);
  const tags: string[] = [];
  if (facts.isRout) tags.push('Goleada');
  if (facts.comeback) tags.push('Remontada');
  if (facts.isGoallessDraw) tags.push('Sin goles');
  if (facts.lateWinner) tags.push(`Gol al ${facts.lateWinner.minuteLabel}`);
  if (facts.redCards.length) tags.push(facts.redCards.length === 1 ? '1 expulsado' : `${facts.redCards.length} expulsados`);
  return {
    kind: 'resultado',
    competition: competitionLabel(ctx),
    kicker: day ? matchdayKicker(ctx, day) : (match.roundLabel ?? ''),
    match,
    home: ctx.visuals.get(match.homeTeamId)!,
    away: ctx.visuals.get(match.awayTeamId)!,
    homeScore: match.homeScore ?? 0,
    awayScore: match.awayScore ?? 0,
    facts,
    dateLabel: `${local.weekday} ${local.dayMonth}`,
    venue: match.venue ?? undefined,
    group: groupName(ctx, match),
    tags,
    ...standingsAround(ctx, match),
  };
}

function standingsAround(ctx: ViewContext, match: StatMatch): Pick<ResultView, 'leaderChange' | 'homeStanding' | 'awayStanding'> {
  const before = seasonTables(ctx.data, ctx.rules, { until: match.kickoffUtc }).current;
  const after = seasonTables(ctx.data, ctx.rules, { until: new Date(Date.parse(match.kickoffUtc) + 1000).toISOString() }).current;
  const standingOf = (teamId: number) => {
    for (const t of after) {
      const row = t.rows.find((r) => r.teamId === teamId);
      if (row) return { rank: row.position, points: row.points, table: t.label };
    }
    return undefined;
  };
  return { leaderChange: leaderChangeIn(before, after, match), homeStanding: standingOf(match.homeTeamId), awayStanding: standingOf(match.awayTeamId) };
}

function leaderChangeIn(
  before: { rows: StandingRow[] }[],
  after: { rows: StandingRow[] }[],
  match: StatMatch,
): ResultView['leaderChange'] {
  for (let i = 0; i < after.length; i++) {
    const nowLeader = after[i]!.rows[0]?.teamId;
    const prevLeader = before[i]?.rows[0]?.teamId ?? null;
    if (nowLeader !== undefined && nowLeader !== prevLeader && (nowLeader === match.homeTeamId || nowLeader === match.awayTeamId)) {
      return { teamId: nowLeader, previousLeaderId: prevLeader };
    }
  }
  return undefined;
}

// ── Resumen de la fecha ───────────────────────────────────────────────────

export interface SummaryView {
  kind: 'resumen';
  competition: string;
  kicker: string;
  summary: MatchdaySummary;
  results: { match: StatMatch; home: TeamVisual; away: TeamVisual; pending: boolean }[];
}

export function summaryView(ctx: ViewContext, day: Matchday): SummaryView {
  return {
    kind: 'resumen',
    competition: competitionLabel(ctx),
    kicker: matchdayKicker(ctx, day),
    summary: summarizeMatchday(day),
    results: day.matches.map((m) => ({
      match: m,
      home: ctx.visuals.get(m.homeTeamId)!,
      away: ctx.visuals.get(m.awayTeamId)!,
      pending: m.status !== 'finished',
    })),
  };
}

// ── Tabla de posiciones ───────────────────────────────────────────────────

export interface StandingsView {
  kind: 'tabla';
  competition: string;
  kicker: string;
  tables: { label: string; rows: (StandingRow & { team: TeamVisual; movement: number })[] }[];
  /** Huella de la tabla para publicar solo si cambió. */
  fingerprint: string;
}

export function standingsView(ctx: ViewContext, afterDay?: Matchday): StandingsView {
  const tables = seasonTables(ctx.data, ctx.rules);
  const movement = afterDay ? tableMovement(ctx.data, ctx.rules, afterDay.firstKickoff) : new Map<number, number>();
  const view = tables.current.map((t) => ({
    label: t.label,
    rows: t.rows.map((r) => ({ ...r, team: ctx.visuals.get(r.teamId)!, movement: movement.get(r.teamId) ?? 0 })),
  }));
  const fingerprint = view.map((t) => `${t.label}:${t.rows.map((r) => `${r.teamId}/${r.played}/${r.points}/${r.goalDiff}`).join(',')}`).join('|');
  // "Tras la fecha N" solo si no hay resultados posteriores a esa fecha; si no, la fecha del último resultado.
  const finished = leagueMatches(ctx.data).filter((m) => m.status === 'finished');
  const lastResult = finished.reduce((max, m) => (m.kickoffUtc > max ? m.kickoffUtc : max), '');
  const afterDayIsLatest = afterDay && afterDay.complete && !finished.some((m) => m.kickoffUtc > afterDay.lastKickoff && !afterDay.matches.includes(m));
  const kicker = afterDayIsLatest
    ? `Tras la ${matchdayKicker(ctx, afterDay).replace('Fecha', 'fecha')}`
    : lastResult
      ? `Actualizada al ${toLocal(lastResult, ctx.timeZone).dayMonth}`
      : 'Posiciones';
  return {
    kind: 'tabla',
    competition: competitionLabel(ctx),
    kicker,
    tables: view,
    fingerprint,
  };
}

// ── Goleadores ────────────────────────────────────────────────────────────

export interface ScorersView {
  kind: 'goleadores';
  competition: string;
  kicker: string;
  rows: (ScorerRow & { team: TeamVisual })[];
  tiedOutside: number;
  unattributedGoals: number;
  fingerprint: string;
}

export function scorersView(ctx: ViewContext, limit = 10): ScorersView {
  const table = computeScorers(leagueMatches(ctx.data), ctx.data.events, ctx.data.players);
  const { rows, tiedOutside } = topScorers(table, limit);
  return {
    kind: 'goleadores',
    competition: competitionLabel(ctx),
    kicker: `Top ${limit} de la temporada`,
    rows: rows.map((r) => ({ ...r, team: ctx.visuals.get(r.teamId)! })),
    tiedOutside,
    unattributedGoals: table.unattributedGoals,
    fingerprint: rows.map((r) => `${r.playerId}/${r.goals}`).join(','),
  };
}

// ── Estadísticas de un equipo ─────────────────────────────────────────────

export interface TeamStatsView {
  kind: 'equipo';
  competition: string;
  kicker: string;
  team: TeamVisual;
  profile: TeamProfile;
  position?: { rank: number; table: string; points: number };
  last5: { outcome: 'W' | 'D' | 'L'; opponent: TeamVisual; home: boolean; goalsFor: number; goalsAgainst: number }[];
}

export function teamStatsView(ctx: ViewContext, teamId: number): TeamStatsView {
  const profile = teamProfile(teamId, leagueMatches(ctx.data), { pointsWin: ctx.rules.puntosVictoria, pointsDraw: ctx.rules.puntosEmpate });
  const tables = seasonTables(ctx.data, ctx.rules).current;
  let position: TeamStatsView['position'];
  for (const t of tables) {
    const row = t.rows.find((r) => r.teamId === teamId);
    if (row) position = { rank: row.position, table: t.label, points: row.points };
  }
  return {
    kind: 'equipo',
    competition: competitionLabel(ctx),
    kicker: 'Números de la temporada',
    team: ctx.visuals.get(teamId)!,
    profile,
    position,
    last5: profile.last5.map((e) => ({ outcome: e.outcome, opponent: ctx.visuals.get(e.opponentId)!, home: e.home, goalsFor: e.goalsFor, goalsAgainst: e.goalsAgainst })),
  };
}

// ── Previa: carrusel de portada, comparativa y duelos ─────────────────────

export interface ComparisonRow {
  label: string;
  home: number;
  away: number;
  homeText?: string;
  awayText?: string;
  /** Qué valor es mejor: define qué lado se resalta. */
  better: 'higher' | 'lower';
}

export interface PreviewSide {
  team: TeamVisual;
  profile: TeamProfile;
  stats: TeamEventStats;
  rank?: number;
  /** "3º · Grupo 3" o "3º en la tabla" */
  rankLabel?: string;
  points?: number;
  /** "10G 8E 16P" */
  record: string;
  /** Racha vigente en texto, si es notable. */
  streak?: string;
}

export interface HeadToHeadView {
  kind: 'duelo';
  competition: string;
  kicker: string;
  match: StatMatch;
  home: TeamVisual;
  away: TeamVisual;
  dateLabel: string;
  time: string;
  venue?: string;
  city?: string;
  h2h: HeadToHead;
  previous: { match: StatMatch; home: TeamVisual; away: TeamVisual; date: string; scorers: string }[];
  homeSide: PreviewSide;
  awaySide: PreviewSide;
  comparison: ComparisonRow[];
  // Atajos usados por el texto
  homeForm: TeamProfile;
  awayForm: TeamProfile;
  homeRankLabel?: string;
  awayRankLabel?: string;
}

export function headToHeadView(ctx: ViewContext, match: StatMatch, day?: Matchday): HeadToHeadView {
  const league = leagueMatches(ctx.data);
  const h2h = headToHead(match.homeTeamId, match.awayTeamId, league, { before: match.kickoffUtc });
  const local = toLocal(match.kickoffUtc, ctx.timeZone);
  const tables = seasonTables(ctx.data, ctx.rules, { until: match.kickoffUtc }).current;
  const opts = { pointsWin: ctx.rules.puntosVictoria, pointsDraw: ctx.rules.puntosEmpate, until: match.kickoffUtc };

  const side = (teamId: number): PreviewSide => {
    const profile = teamProfile(teamId, league, opts);
    const table = tables.find((t) => t.rows.some((r) => r.teamId === teamId));
    const row = table?.rows.find((r) => r.teamId === teamId);
    const t = profile.total;
    return {
      team: ctx.visuals.get(teamId)!,
      profile,
      stats: teamEventStats(teamId, league, ctx.data.events, ctx.data.players, { until: match.kickoffUtc }),
      rank: row?.position,
      rankLabel: row && table ? (tables.length > 1 ? `${row.position}º · ${table.label}` : `${row.position}º en la tabla`) : undefined,
      points: row?.points,
      record: `${t.won}G ${t.drawn}E ${t.lost}P`,
      streak: streakLabel(profile),
    };
  };
  const homeSide = side(match.homeTeamId);
  const awaySide = side(match.awayTeamId);

  const previous = h2h.played.map((m) => {
    const facts = matchFacts(m, ctx.data.events, ctx.data.players);
    const byTeam = (teamId: number) => facts.scorers.filter((s) => s.teamId === teamId).map((s) => `${s.name} ${s.minutes.join(', ')}`).join(', ');
    const parts = [m.homeTeamId, m.awayTeamId]
      .map((id) => ({ abbr: ctx.visuals.get(id)!.abbr, list: byTeam(id) }))
      .filter((p) => p.list)
      .map((p) => `${p.abbr}: ${p.list}`);
    return {
      match: m,
      home: ctx.visuals.get(m.homeTeamId)!,
      away: ctx.visuals.get(m.awayTeamId)!,
      date: toLocal(m.kickoffUtc, ctx.timeZone).short,
      scorers: parts.join(' · ') || (m.homeScore === 0 && m.awayScore === 0 ? 'Sin goles' : ''),
    };
  });

  return {
    kind: 'duelo',
    competition: competitionLabel(ctx),
    kicker: day ? `Previa · ${matchdayKicker(ctx, day)}` : 'Previa',
    match,
    home: homeSide.team,
    away: awaySide.team,
    dateLabel: `${local.weekday} ${local.dayMonth}`,
    time: local.time,
    venue: match.venue ?? undefined,
    city: match.city ?? undefined,
    h2h,
    previous,
    homeSide,
    awaySide,
    comparison: compareSides(homeSide, awaySide),
    homeForm: homeSide.profile,
    awayForm: awaySide.profile,
    homeRankLabel: homeSide.rankLabel,
    awayRankLabel: awaySide.rankLabel,
  };
}

const dec = (n: number) => n.toFixed(2).replace('.', ',');
const perGame = (value: number, played: number) => (played ? value / played : 0);

/** Filas de la comparativa, de la más a la menos relevante (las plantillas recortan desde el final). */
function compareSides(h: PreviewSide, a: PreviewSide): ComparisonRow[] {
  const ht = h.profile.total;
  const at = a.profile.total;
  const homePpg = perGame(h.profile.home.points, h.profile.home.played);
  const awayPpg = perGame(a.profile.away.points, a.profile.away.played);
  return [
    { label: 'Puntos', home: h.points ?? ht.points, away: a.points ?? at.points, better: 'higher' },
    { label: 'Goles a favor', home: ht.goalsFor, away: at.goalsFor, better: 'higher' },
    { label: 'Goles en contra', home: ht.goalsAgainst, away: at.goalsAgainst, better: 'lower' },
    {
      label: `Pts por partido · ${h.team.abbr} local / ${a.team.abbr} visita`,
      home: homePpg,
      away: awayPpg,
      homeText: dec(homePpg),
      awayText: dec(awayPpg),
      better: 'higher',
    },
    { label: 'Vallas invictas', home: ht.cleanSheets, away: at.cleanSheets, better: 'higher' },
    {
      label: 'Goles por partido',
      home: perGame(ht.goalsFor, ht.played),
      away: perGame(at.goalsFor, at.played),
      homeText: dec(perGame(ht.goalsFor, ht.played)),
      awayText: dec(perGame(at.goalsFor, at.played)),
      better: 'higher',
    },
    { label: 'Goles en el 2º tiempo', home: h.stats.goalsSecondHalf, away: a.stats.goalsSecondHalf, better: 'higher' },
    { label: 'Expulsiones', home: h.stats.redCards, away: a.stats.redCards, better: 'lower' },
  ];
}

function streakLabel(p: TeamProfile): string | undefined {
  const s = p.streaks;
  if (s.wins >= 2) return `${s.wins} victorias seguidas`;
  if (s.unbeaten >= 3) return `${s.unbeaten} partidos sin perder`;
  if (s.losses >= 2) return `${s.losses} derrotas seguidas`;
  if (s.winless >= 3) return `${s.winless} partidos sin ganar`;
  return undefined;
}

// ── Alineaciones confirmadas ──────────────────────────────────────────────

export interface LineupKit {
  /** Color de la camiseta. */
  fill: string;
  /** Color del dorsal, siempre legible sobre la camiseta. */
  number: string;
  /** Color del cuello. */
  trim: string;
}

export interface LineupSide {
  team: TeamVisual;
  formation: string | null;
  kit: LineupKit;
  /** Titulares por filas: arquero primero; cada fila de banda izquierda a derecha del equipo. */
  rows: StatLineupPlayer[][];
  bench: StatLineupPlayer[];
}

export interface LineupsView {
  kind: 'alineaciones';
  competition: string;
  kicker: string;
  match: StatMatch;
  home: LineupSide;
  away: LineupSide;
  dateLabel: string;
  time: string;
  venue?: string;
}

export function lineupsView(ctx: ViewContext, match: StatMatch, day?: Matchday): LineupsView {
  const lineups = ctx.data.lineups.get(match.id) ?? [];
  const side = (teamId: number): LineupSide => {
    const l = lineups.find((x) => x.teamId === teamId);
    if (!l) throw new Error(`El partido ${match.id} no tiene alineación del equipo ${teamId}`);
    return {
      team: ctx.visuals.get(teamId)!,
      formation: l.formation,
      kit: kitFor(ctx.visuals.get(teamId)!, l),
      rows: lineupRows(l.formation, l.players.filter((p) => p.starter)),
      bench: l.players.filter((p) => !p.starter),
    };
  };
  const local = toLocal(match.kickoffUtc, ctx.timeZone);
  return {
    kind: 'alineaciones',
    competition: competitionLabel(ctx),
    kicker: day ? matchdayKicker(ctx, day) : (match.roundLabel ?? ''),
    match,
    home: side(match.homeTeamId),
    away: side(match.awayTeamId),
    dateLabel: `${local.weekday} ${local.dayMonth}`,
    time: local.time,
    venue: match.venue ?? undefined,
  };
}

/** La camiseta que el equipo usa en el partido; si la fuente no la informa, sus colores de siempre. */
function kitFor(team: TeamVisual, lineup: StatLineup): LineupKit {
  const fill = lineup.kitColor ?? team.color;
  const detail = lineup.kitColor ? (lineup.kitDetail ?? null) : team.textColor;
  const number = detail && contrastRatio(fill, detail) >= 3 ? detail : readableOn(fill);
  return { fill, number, trim: detail ?? number };
}

export type AnyView = FixturesView | ResultView | SummaryView | StandingsView | ScorersView | TeamStatsView | HeadToHeadView | LineupsView;
