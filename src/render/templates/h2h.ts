// 7. Previa en carrusel:
//   1/3 La previa: equipos, hora, estadio, puesto, balance, últimos 5 y racha.
//   2/3 Cara a cara en números: comparativa de la temporada y goleador de cada equipo.
//   3/3 Duelos del año: historial entre ambos con goleadores (se omite si no hay).

import type { HeadToHeadView, PreviewSide } from '../../content/views.ts';
import { frame, type BrandInfo } from '../../design/components/brand.ts';
import { matchRow } from '../../design/components/match.ts';
import { bigStat, card, chip, compareRow, formDots } from '../../design/components/stats.ts';
import { teamMark } from '../../design/components/team.ts';
import { h, line, type VNode } from '../../design/h.ts';
import { fitSize } from '../../design/text-fit.ts';
import { fonts, palette, type, type Format } from '../../design/tokens.ts';
import { capitalize, contentWidth, isCompact, sectionLabel } from './common.ts';

export function previewSlides(view: HeadToHeadView, format: Format, brand: BrandInfo): VNode[] {
  const withHistory = view.previous.length > 0;
  const total = withHistory ? 3 : 2;
  const slides = [cover(view, format, brand, total), comparison(view, format, brand, total)];
  if (withHistory) slides.push(history(view, format, brand, total));
  return slides;
}

/** Compatibilidad con el render de una sola imagen: la portada. */
export function h2hTemplate(view: HeadToHeadView, format: Format, brand: BrandInfo): VNode {
  return previewSlides(view, format, brand)[0]!;
}

function pager(n: number, total: number): string {
  return `${n}/${total}`;
}

// ── 1. Portada ────────────────────────────────────────────────────────────

function cover(view: HeadToHeadView, format: Format, brand: BrandInfo, total: number): VNode {
  const width = contentWidth(format);
  const compact = isCompact(format);
  const side = Math.floor((width - 200) / 2);
  const markSize = compact ? 116 : 168;

  const teamBlock = (s: PreviewSide) =>
    h(
      'div',
      { flexDirection: 'column', alignItems: 'center', width: side, gap: compact ? 10 : 14 },
      teamMark(s.team, markSize),
      line(s.team.shortName.toUpperCase(), { fontFamily: fonts.display, fontWeight: 800, fontSize: fitSize(s.team.shortName, side - 10, compact ? 42 : 50, 28, 'display'), color: palette.paper, maxWidth: side }),
      s.rankLabel ? h('div', { gap: 8 }, chip(s.rankLabel, 'muted', type.micro), s.points !== undefined ? chip(`${s.points} pts`, 'outline', type.micro) : null) : null,
    );

  const center = h(
    'div',
    { width: 200, flexDirection: 'column', alignItems: 'center', gap: 6 },
    h('div', { fontFamily: fonts.display, fontWeight: 800, fontSize: compact ? 64 : 80, color: palette.accent, lineHeight: 1 }, view.time),
    line(capitalize(view.dateLabel), { fontFamily: fonts.display, fontWeight: 600, fontSize: type.small, color: palette.muted }),
  );

  const infoCard = (s: PreviewSide, align: 'flex-start' | 'flex-end') => {
    const t = s.profile.total;
    const w = Math.floor((width - 16) / 2);
    const row = (label: string, value: VNode | string) =>
      h('div', { flexDirection: 'column', gap: 6, alignItems: align }, sectionLabel(label, { size: type.micro }), typeof value === 'string' ? line(value, { fontFamily: fonts.display, fontWeight: 700, fontSize: compact ? 30 : 36, color: palette.paper }) : value);
    return card(
      [
        row('Temporada', s.record),
        row('Goles', `${t.goalsFor} a favor · ${t.goalsAgainst} en contra`),
        row('Últimos 5', formDots(s.profile.last5.map((e) => e.outcome), compact ? 30 : 36)),
        s.streak && !compact ? line(capitalize(s.streak), { fontFamily: fonts.display, fontWeight: 700, fontSize: type.small, color: palette.accent, textAlign: align === 'flex-end' ? 'right' : 'left' }) : null,
      ].filter(Boolean) as VNode[],
      { flexDirection: 'column', width: w, gap: compact ? 12 : 18, padding: compact ? '16px 20px' : '24px 24px', alignItems: align },
    );
  };

  // Dato clave del partido: el local en su casa frente al visitante fuera.
  const split = (s: PreviewSide, where: 'home' | 'away', align: 'flex-start' | 'flex-end') => {
    const x = s.profile[where];
    return h(
      'div',
      { flexDirection: 'column', gap: 6, alignItems: align, width: Math.floor((width - 48 - 24) / 2) },
      sectionLabel(`${s.team.shortName} ${where === 'home' ? 'de local' : 'de visita'}`, { size: type.micro }),
      line(`${x.won}G ${x.drawn}E ${x.lost}P`, { fontFamily: fonts.display, fontWeight: 800, fontSize: compact ? 32 : 40, color: palette.paper }),
      line(`${x.points} pts en ${x.played} partidos · ${x.goalsFor}-${x.goalsAgainst} en goles`, { fontSize: type.micro, color: palette.muted }),
    );
  };
  const splits = card([split(view.homeSide, 'home', 'flex-start'), h('div', { width: 1, height: compact ? 70 : 90, backgroundColor: palette.line }), split(view.awaySide, 'away', 'flex-end')], {
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: compact ? '14px 24px' : '22px 24px',
    width,
  });

  const where = [view.venue, view.city].filter(Boolean).join(' · ');
  const body = [
    h('div', { alignItems: 'center', justifyContent: 'space-between', width }, teamBlock(view.homeSide), center, teamBlock(view.awaySide)),
    where ? line(where, { marginTop: compact ? 10 : 18, fontSize: type.small, color: palette.faint, justifyContent: 'center', width }) : null,
    h('div', { gap: 16, width, marginTop: compact ? 16 : 32 }, infoCard(view.homeSide, 'flex-start'), infoCard(view.awaySide, 'flex-end')),
    compact ? null : h('div', { marginTop: 16 }, splits),
    h('div', { flexGrow: 1 }),
    swipeHint('Desliza: cara a cara en números', width),
  ];
  const kicker = view.kicker.replace(/^Previa · /, '');
  return frame({ format, brand, competition: view.competition, kicker: `${kicker} · ${pager(1, total)}`, title: 'La previa', titleAccent: 'previa', body });
}

// ── 2. Comparativa ────────────────────────────────────────────────────────

function comparison(view: HeadToHeadView, format: Format, brand: BrandInfo, total: number): VNode {
  const width = contentWidth(format);
  const compact = isCompact(format);
  const scorersHeight = compact ? 128 : 140;
  // En cuadrado entran 6 filas legibles; en vertical, todas las de la comparativa.
  const rows = view.comparison.slice(0, compact ? 6 : 8);

  const header = h(
    'div',
    { justifyContent: 'space-between', alignItems: 'center', width, marginBottom: compact ? 10 : 18 },
    h('div', { alignItems: 'center', gap: 14 }, teamMark(view.home, 56), line(view.home.shortName, { fontFamily: fonts.display, fontWeight: 800, fontSize: 34, color: palette.paper })),
    h('div', { fontFamily: fonts.display, fontWeight: 800, fontSize: 28, color: palette.faint }, 'VS'),
    h('div', { alignItems: 'center', gap: 14 }, line(view.away.shortName, { fontFamily: fonts.display, fontWeight: 800, fontSize: 34, color: palette.paper }), teamMark(view.away, 56)),
  );

  const scorer = (s: PreviewSide, align: 'flex-start' | 'flex-end') =>
    card(
      [
        sectionLabel(`Goleador ${s.team.abbr}`, { size: type.micro, color: palette.accent }),
        line(s.stats.topScorer?.name ?? 'Sin goles registrados', { fontFamily: fonts.display, fontWeight: 800, fontSize: compact ? 30 : 36, color: palette.paper, maxWidth: Math.floor((width - 16) / 2) - 48 }),
        line(s.stats.topScorer ? `${s.stats.topScorer.goals} gol${s.stats.topScorer.goals === 1 ? '' : 'es'} en la temporada` : '—', { fontSize: type.small, color: palette.muted }),
      ],
      { flexDirection: 'column', width: Math.floor((width - 16) / 2), height: scorersHeight, gap: 4, padding: '16px 24px', justifyContent: 'center', alignItems: align },
    );

  const body = [
    header,
    h(
      'div',
      { flexDirection: 'column', flexGrow: 1, justifyContent: 'space-between', paddingBottom: compact ? 16 : 28 },
      rows.map((r) => compareRow({ ...r, width, numberSize: compact ? 34 : 40 })),
    ),
    h('div', { gap: 16, width, flexShrink: 0 }, scorer(view.homeSide, 'flex-start'), scorer(view.awaySide, 'flex-end')),
  ];
  return frame({ format, brand, competition: view.competition, kicker: `Previa ${view.home.abbr} vs ${view.away.abbr} · ${pager(2, total)}`, title: 'Cara a cara', titleAccent: 'cara', body });
}

// ── 3. Duelos del año ─────────────────────────────────────────────────────

function history(view: HeadToHeadView, format: Format, brand: BrandInfo, total: number): VNode {
  const width = contentWidth(format);
  const compact = isCompact(format);
  const h2h = view.h2h;
  const count = Math.max(1, h2h.winsA + h2h.draws + h2h.winsB);
  const barW = width - 48;
  const seg = (n: number, color: string) => (n > 0 ? h('div', { width: Math.max(8, Math.round((n / count) * barW) - 4), height: 18, borderRadius: 9, backgroundColor: color }) : null);

  const balance = card(
    [
      h(
        'div',
        { justifyContent: 'space-between', width: barW },
        countLabel(h2h.winsA, `gana ${view.home.abbr}`),
        countLabel(h2h.draws, h2h.draws === 1 ? 'empate' : 'empates'),
        countLabel(h2h.winsB, `gana ${view.away.abbr}`),
      ),
      h('div', { gap: 4, width: barW, marginTop: 12 }, seg(h2h.winsA, palette.accent), seg(h2h.draws, palette.muted), seg(h2h.winsB, palette.paper)),
      line(`Goles en sus duelos: ${view.home.abbr} ${h2h.goalsA} · ${h2h.goalsB} ${view.away.abbr}`, { marginTop: 14, fontSize: type.small, color: palette.muted }),
    ],
    { flexDirection: 'column', padding: '22px 24px' },
  );

  const shown = view.previous.slice(-(compact ? 3 : 4));
  const meetings = shown.map((p) =>
    matchRow({ home: p.home, away: p.away, width, height: compact ? 92 : 104, center: `${p.match.homeScore} - ${p.match.awayScore}`, centerTone: 'score', lead: p.date, note: p.scorers || undefined }),
  );

  const played = h2h.played.length;
  const last = h2h.played.at(-1)!;
  const lastWinner = last.homeScore! > last.awayScore! ? last.homeTeamId : last.awayScore! > last.homeScore! ? last.awayTeamId : null;
  const lastWinnerAbbr = lastWinner === null ? 'Empate' : lastWinner === view.home.id ? view.home.abbr : view.away.abbr;
  const totals = h(
    'div',
    { justifyContent: 'space-between', width, padding: '0 8px', marginTop: compact ? 16 : 32 },
    bigStat(String(played), played === 1 ? 'partido' : 'partidos'),
    bigStat(String(h2h.goalsA + h2h.goalsB), 'goles'),
    bigStat(((h2h.goalsA + h2h.goalsB) / played).toFixed(2).replace('.', ','), 'goles por partido'),
    bigStat(lastWinnerAbbr, 'último ganador', { color: palette.accent }),
  );

  const body = [
    balance,
    h('div', { flexDirection: 'column', gap: 10, marginTop: compact ? 16 : 28 }, sectionLabel('Partidos de este año'), meetings),
    totals,
    h('div', { flexGrow: 1 }),
    line(`Próximo: ${capitalize(view.dateLabel)}, ${view.time}${view.venue ? ` · ${view.venue}` : ''}`, { fontFamily: fonts.display, fontWeight: 600, fontSize: type.small, color: palette.accent }),
  ];
  return frame({ format, brand, competition: view.competition, kicker: `Previa ${view.home.abbr} vs ${view.away.abbr} · ${pager(3, total)}`, title: 'Duelos del año', titleAccent: 'año', body });
}

function countLabel(n: number, label: string): VNode {
  return h(
    'div',
    { alignItems: 'baseline', gap: 10 },
    h('div', { fontFamily: fonts.display, fontWeight: 800, fontSize: type.big, color: palette.paper }, String(n)),
    h('div', { fontFamily: fonts.display, fontWeight: 600, fontSize: type.small, color: palette.muted, letterSpacing: 1 }, label.toUpperCase()),
  );
}

function swipeHint(text: string, width: number): VNode {
  return h(
    'div',
    { width, justifyContent: 'flex-end', alignItems: 'center', gap: 12 },
    line(text.toUpperCase(), { fontFamily: fonts.display, fontWeight: 700, fontSize: type.micro + 2, letterSpacing: 2, color: palette.muted }),
    h('div', { width: 40, height: 4, borderRadius: 2, backgroundColor: palette.accent }),
  );
}
