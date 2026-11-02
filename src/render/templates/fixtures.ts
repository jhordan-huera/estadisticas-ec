// 1. Cartelera de la fecha: partidos agrupados por día con hora de Ecuador y estadio.

import type { FixturesView } from '../../content/views.ts';
import { frame, type BrandInfo } from '../../design/components/brand.ts';
import { matchRow } from '../../design/components/match.ts';
import { h, type VNode } from '../../design/h.ts';
import type { Format } from '../../design/tokens.ts';
import { bodyHeight, contentWidth, dayHeader, isCompact } from './common.ts';

export function fixturesTemplate(view: FixturesView, format: Format, brand: BrandInfo): VNode {
  const width = contentWidth(format);
  const compact = isCompact(format);
  const count = view.days.reduce((n, d) => n + d.items.length, 0);
  const gap = compact ? 6 : 10;
  const dayBlock = 36 + (compact ? 2 : 8);
  const rowHeight = Math.max(56, Math.min(compact ? 84 : 104, Math.floor((bodyHeight(format) - view.days.length * dayBlock - (count - 1) * gap) / Math.max(1, count))));
  const withNote = !compact && rowHeight >= 88;

  const body = view.days.map((day) =>
    h(
      'div',
      { flexDirection: 'column', gap, marginBottom: compact ? 2 : 8 },
      dayHeader(day.label, width),
      day.items.map((item) =>
        matchRow({
          home: item.home,
          away: item.away,
          width,
          height: rowHeight,
          lead: item.time,
          center: item.status === 'postponed' ? 'APLAZ.' : 'VS',
          centerTone: 'time',
          note: withNote ? [item.group, item.venue].filter(Boolean).join(' · ') : undefined,
        }),
      ),
    ),
  );

  return frame({ format, brand, competition: view.competition, kicker: view.kicker, title: 'Cartelera', titleAccent: 'Cartelera', body });
}
