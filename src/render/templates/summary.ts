// 3. Resumen de la fecha: todos los resultados, mayor goleada y partido con más goles.

import type { SummaryView } from '../../content/views.ts';
import { frame, type BrandInfo } from '../../design/components/brand.ts';
import { matchRow } from '../../design/components/match.ts';
import { bigStat, card } from '../../design/components/stats.ts';
import type { TeamVisual } from '../../design/components/team.ts';
import { h, line, type VNode } from '../../design/h.ts';
import { fonts, palette, type, type Format } from '../../design/tokens.ts';
import type { StatMatch } from '../../stats/types.ts';
import { bodyHeight, contentWidth, isCompact, sectionLabel } from './common.ts';

export function summaryTemplate(view: SummaryView, format: Format, brand: BrandInfo): VNode {
  const width = contentWidth(format);
  const compact = isCompact(format);
  const s = view.summary;
  const highlightHeight = compact ? 120 : 150;
  const totalsHeight = compact ? 0 : 96;
  const gap = 8;
  const n = Math.max(1, view.results.length);
  const rowHeight = Math.max(52, Math.min(80, Math.floor((bodyHeight(format) - highlightHeight - totalsHeight - 40 - (n - 1) * gap) / n)));

  const visuals = new Map<number, TeamVisual>();
  for (const r of view.results) {
    visuals.set(r.home.id, r.home);
    visuals.set(r.away.id, r.away);
  }
  const scoreText = (m: StatMatch) => `${visuals.get(m.homeTeamId)!.abbr} ${m.homeScore}-${m.awayScore} ${visuals.get(m.awayTeamId)!.abbr}`;

  const highlight = (label: string, m: StatMatch | null, w: number) =>
    card(
      [
        sectionLabel(label, { color: palette.accent, size: type.micro + 2 }),
        line(m ? scoreText(m) : '—', { fontFamily: fonts.display, fontWeight: 800, fontSize: compact ? 46 : 56, color: palette.paper, marginTop: 6 }),
      ],
      { flexDirection: 'column', width: w, height: highlightHeight, padding: '18px 24px', justifyContent: 'center' },
    );

  const half = Math.floor((width - 16) / 2);
  const body = [
    h(
      'div',
      { flexDirection: 'column', gap },
      view.results.map((r) =>
        matchRow({
          home: r.home,
          away: r.away,
          width,
          height: rowHeight,
          center: r.pending ? (r.match.status === 'postponed' ? 'APLAZ.' : 'PEND.') : `${r.match.homeScore} - ${r.match.awayScore}`,
          centerTone: r.pending ? 'pending' : 'score',
          highlight: !r.pending && (r.match === s.biggestWin || r.match === s.highestScoring),
        }),
      ),
    ),
    h('div', { gap: 16, marginTop: 20, width }, highlight('Mayor goleada', s.biggestWin, half), highlight('Partido con más goles', s.highestScoring, half)),
    totalsHeight
      ? h(
          'div',
          { justifyContent: 'space-between', marginTop: 24, width, padding: '0 8px' },
          bigStat(String(s.goals), 'goles'),
          bigStat(s.averageGoals.toFixed(2).replace('.', ','), 'por partido'),
          bigStat(String(s.homeWins), 'ganó el local'),
          bigStat(String(s.draws), 'empates'),
          bigStat(String(s.awayWins), 'ganó la visita'),
        )
      : null,
  ];

  return frame({ format, brand, competition: view.competition, kicker: view.kicker, title: 'Resumen de la fecha', titleAccent: 'fecha', body });
}
