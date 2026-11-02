// 5. Tabla de goleadores (top 10), acumulada partido a partido.

import type { ScorersView } from '../../content/views.ts';
import { frame, type BrandInfo } from '../../design/components/brand.ts';
import { meter } from '../../design/components/stats.ts';
import { teamMark } from '../../design/components/team.ts';
import { withAlpha } from '../../design/color.ts';
import { h, line, type VNode } from '../../design/h.ts';
import { fonts, palette, type, type Format } from '../../design/tokens.ts';
import { bodyHeight, contentWidth } from './common.ts';

export function scorersTemplate(view: ScorersView, format: Format, brand: BrandInfo): VNode {
  const width = contentWidth(format);
  const notes = [
    view.tiedOutside ? `Y ${view.tiedOutside} jugador${view.tiedOutside > 1 ? 'es' : ''} más con ${view.rows.at(-1)?.goals} goles` : '',
    view.unattributedGoals ? `${view.unattributedGoals} gol${view.unattributedGoals > 1 ? 'es' : ''} sin autor registrado en la fuente` : '',
  ].filter(Boolean);
  const gap = 6;
  const n = Math.max(1, view.rows.length);
  const rowHeight = Math.max(54, Math.min(86, Math.floor((bodyHeight(format) - (notes.length ? 44 : 0) - (n - 1) * gap) / n)));
  const top = view.rows[0]?.goals ?? 1;

  const rows = view.rows.map((r, i) => {
    const leader = r.position === 1;
    return h(
      'div',
      {
        width,
        height: rowHeight,
        alignItems: 'center',
        padding: '0 20px',
        borderRadius: 14,
        backgroundColor: leader ? withAlpha(palette.accent, 0.1) : i % 2 ? palette.inkRaised : 'transparent',
        borderLeft: `6px solid ${leader ? palette.accent : 'transparent'}`,
      },
      h('div', { width: 64, fontFamily: fonts.display, fontWeight: 800, fontSize: Math.round(rowHeight * 0.46), color: leader ? palette.accent : palette.muted }, String(r.position)),
      teamMark(r.team, Math.round(rowHeight * (r.team.logo ? 0.76 : 0.58))),
      h(
        'div',
        { flexDirection: 'column', flexGrow: 1, marginLeft: 20, gap: 4 },
        line(r.name, { fontFamily: fonts.display, fontWeight: 700, fontSize: Math.round(rowHeight * 0.4), color: palette.paper, maxWidth: width - 420 }),
        h('div', { alignItems: 'center', gap: 12 }, meter(r.goals, top, 220, leader ? palette.accent : palette.muted), line(r.penalties ? `${r.penalties} de penal` : r.team.shortName, { fontSize: type.micro, color: palette.faint })),
      ),
      h(
        'div',
        { alignItems: 'baseline', gap: 8, justifyContent: 'flex-end', width: 150 },
        h('div', { fontFamily: fonts.display, fontWeight: 800, fontSize: Math.round(rowHeight * 0.62), color: leader ? palette.accent : palette.paper }, String(r.goals)),
        h('div', { fontFamily: fonts.display, fontWeight: 600, fontSize: type.micro, color: palette.muted }, r.goals === 1 ? 'GOL' : 'GOLES'),
      ),
    );
  });

  const body = [
    h('div', { flexDirection: 'column', gap }, rows),
    notes.length ? line(notes.join(' · '), { marginTop: 16, fontSize: type.micro, color: palette.muted }) : null,
  ];
  return frame({ format, brand, competition: view.competition, kicker: view.kicker, title: 'Goleadores', titleAccent: 'Goleadores', body });
}
