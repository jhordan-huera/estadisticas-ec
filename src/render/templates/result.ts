// 2. Resultado de un partido: marcador, goleadores con minuto y expulsiones.

import type { ResultView } from '../../content/views.ts';
import { frame, type BrandInfo } from '../../design/components/brand.ts';
import { card, chip } from '../../design/components/stats.ts';
import { teamMark, type TeamVisual } from '../../design/components/team.ts';
import { h, line, type VNode } from '../../design/h.ts';
import { fitSize } from '../../design/text-fit.ts';
import { fonts, palette, type, type Format } from '../../design/tokens.ts';
import type { CardLine, ScorerLine } from '../../stats/match-facts.ts';
import { capitalize, contentWidth, isCompact, sectionLabel } from './common.ts';

export function resultTemplate(view: ResultView, format: Format, brand: BrandInfo): VNode {
  const width = contentWidth(format);
  const compact = isCompact(format);
  const markSize = compact ? 148 : 220;
  const sideWidth = Math.floor((width - 300) / 2);

  const teamColumn = (team: TeamVisual, standing: ResultView['homeStanding']) =>
    h(
      'div',
      { flexDirection: 'column', alignItems: 'center', width: sideWidth, gap: compact ? 12 : 18 },
      teamMark(team, markSize),
      line(team.shortName.toUpperCase(), {
        fontFamily: fonts.display,
        fontWeight: 800,
        fontSize: fitSize(team.shortName, sideWidth - 10, compact ? 44 : 56, 30, 'display'),
        color: palette.paper,
        maxWidth: sideWidth,
      }),
      standing ? line(`${standing.rank}º · ${standing.points} pts`, { fontFamily: fonts.display, fontWeight: 600, fontSize: type.small, color: palette.muted, letterSpacing: 1 }) : null,
    );

  const score = h(
    'div',
    { width: 300, justifyContent: 'center', alignItems: 'center', fontFamily: fonts.display, fontWeight: 800, fontSize: compact ? 136 : 190, lineHeight: 1, color: palette.paper, gap: 18 },
    h('div', {}, String(view.homeScore)),
    h('div', { color: palette.faint, fontSize: compact ? 90 : 110 }, '-'),
    h('div', {}, String(view.awayScore)),
  );

  const homeScorers = view.facts.scorers.filter((s) => s.teamId === view.home.id);
  const awayScorers = view.facts.scorers.filter((s) => s.teamId === view.away.id);
  const homeCards = view.facts.redCards.filter((c) => c.teamId === view.home.id);
  const awayCards = view.facts.redCards.filter((c) => c.teamId === view.away.id);
  const maxLines = compact ? 4 : 6;

  const eventColumn = (scorers: ScorerLine[], cards: CardLine[], align: 'flex-start' | 'flex-end') =>
    h(
      'div',
      { flexDirection: 'column', width: Math.floor((width - 72) / 2), gap: 10, alignItems: align },
      scorers.slice(0, maxLines).map((s) => eventLine(`${s.name}`, s.minutes.join(', '), palette.accent, align)),
      scorers.length > maxLines ? line(`+${scorers.length - maxLines} más`, { color: palette.muted, fontSize: type.small }) : null,
      cards.map((c) => eventLine(c.name, c.minute, palette.red, align, true)),
    );

  const info = [capitalize(view.dateLabel), view.venue, view.group].filter(Boolean).join(' · ');
  const hasEvents = view.facts.scorers.length + view.facts.redCards.length > 0;

  const body = [
    h('div', { gap: 12 }, chip('Final', 'accent'), view.tags.map((t) => chip(t, t.includes('expuls') ? 'loss' : 'muted'))),
    h('div', { flexGrow: 1 }),
    h('div', { alignItems: 'center', justifyContent: 'space-between', width }, teamColumn(view.home, view.homeStanding), score, teamColumn(view.away, view.awayStanding)),
    hasEvents || !view.facts.detailComplete
      ? card(
          [
            h('div', { justifyContent: 'space-between', width: width - 48 }, eventColumn(homeScorers, homeCards, 'flex-start'), eventColumn(awayScorers, awayCards, 'flex-end')),
            !view.facts.detailComplete ? line('La fuente no detalla todos los goles de este partido', { marginTop: 12, fontSize: type.micro, color: palette.muted }) : null,
          ].filter(Boolean) as VNode[],
          { flexDirection: 'column', padding: compact ? '18px 24px' : '28px 24px', marginTop: compact ? 20 : 44 },
        )
      : null,
    h('div', { flexGrow: 1 }),
    sectionLabel(info, { size: type.small, color: palette.muted }),
  ];

  return frame({ format, brand, competition: view.competition, kicker: view.kicker, title: 'Resultado', titleAccent: 'Resultado', body });
}

function eventLine(name: string, minutes: string, color: string, align: 'flex-start' | 'flex-end', isCard = false): VNode {
  const marker = h('div', { width: isCard ? 16 : 12, height: isCard ? 22 : 12, borderRadius: isCard ? 3 : 6, backgroundColor: color });
  const text = h(
    'div',
    { alignItems: 'baseline', gap: 10, flexDirection: align === 'flex-end' ? 'row-reverse' : 'row' },
    line(name, { fontFamily: fonts.display, fontWeight: 700, fontSize: type.body, color: palette.paper, maxWidth: 300 }),
    line(minutes, { fontFamily: fonts.display, fontWeight: 600, fontSize: type.small, color: palette.muted }),
  );
  return h('div', { alignItems: 'center', gap: 12, flexDirection: align === 'flex-end' ? 'row-reverse' : 'row' }, marker, text);
}
