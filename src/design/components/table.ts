// Fila de tabla de posiciones y su encabezado de columnas.

import type { Outcome } from '../../stats/types.ts';
import { withAlpha } from '../color.ts';
import { h, img, line, type VNode } from '../h.ts';
import { fitSize } from '../text-fit.ts';
import { fonts, palette } from '../tokens.ts';
import { formDots } from './stats.ts';
import { teamMark, type TeamVisual } from './team.ts';

export interface TableColumns {
  pos: number;
  team: number;
  played: number;
  diff: number;
  points: number;
  form: number;
  move: number;
}

export function tableColumns(width: number, withForm: boolean): TableColumns {
  const narrow = width < 640;
  const pos = narrow ? 30 : 56;
  const played = narrow ? 40 : 70;
  const diff = narrow ? 50 : 80;
  const points = narrow ? 54 : 90;
  const form = withForm && !narrow ? 200 : 0;
  const move = narrow ? 42 : 56;
  return { pos, played, diff, points, form, move, team: width - pos - played - diff - points - form - move - 24 };
}

export interface TableRowProps {
  position: number;
  team: TeamVisual;
  played: number;
  goalDiff: number;
  points: number;
  form: Outcome[];
  movement: number;
  height: number;
  width: number;
  cols: TableColumns;
  /** Marca visual de zona (p. ej. el líder). */
  zone?: 'leader' | 'none';
  striped?: boolean;
  /** Tamaño común del nombre para toda la tabla (si falta, se ajusta fila por fila). */
  nameSize?: number;
}

/** Tamaño de la marca del equipo en una fila: los escudos ocupan más alto que el recuadro de color. */
export function tableMarkSize(height: number, team: TeamVisual): number {
  return Math.round(height * (team.logo ? 0.86 : 0.66));
}

/** Un solo tamaño de nombre para todas las filas: el mayor con el que cabe el nombre más largo. */
export function uniformNameSize(teams: TeamVisual[], cols: TableColumns, height: number): number {
  const base = Math.round(height * 0.48);
  return Math.min(...teams.map((t) => fitSize(t.shortName, cols.team - tableMarkSize(height, t) - 24, base, 18, 'display')));
}

export function tableRow(p: TableRowProps): VNode {
  const markSize = tableMarkSize(p.height, p.team);
  const fontSize = Math.round(p.height * 0.48);
  const num = { fontFamily: fonts.display, fontWeight: 700, fontSize, justifyContent: 'center' as const };

  return h(
    'div',
    {
      width: p.width,
      height: p.height,
      alignItems: 'center',
      padding: '0 12px',
      borderRadius: 10,
      backgroundColor: p.zone === 'leader' ? withAlpha(palette.accent, 0.1) : p.striped ? palette.inkRaised : 'transparent',
      borderLeft: `6px solid ${p.zone === 'leader' ? palette.accent : 'transparent'}`,
    },
    h('div', { ...num, width: p.cols.pos, color: p.zone === 'leader' ? palette.accent : palette.muted }, String(p.position)),
    h(
      'div',
      { width: p.cols.team, alignItems: 'center', gap: 12 },
      teamMark(p.team, markSize),
      line(p.team.shortName, {
        fontFamily: fonts.display,
        fontWeight: 700,
        fontSize: p.nameSize ?? fitSize(p.team.shortName, p.cols.team - markSize - 24, fontSize, 18, 'display'),
        color: palette.paper,
        maxWidth: p.cols.team - markSize - 20,
      }),
    ),
    h('div', { ...num, width: p.cols.played, color: palette.muted }, String(p.played)),
    h('div', { ...num, width: p.cols.diff, color: palette.muted }, p.goalDiff > 0 ? `+${p.goalDiff}` : String(p.goalDiff)),
    h('div', { ...num, width: p.cols.points, fontWeight: 800, color: palette.paper, fontSize: fontSize + 4 }, String(p.points)),
    p.cols.form ? h('div', { width: p.cols.form, justifyContent: 'center' }, formDots(p.form, Math.round(p.height * 0.48))) : null,
    movementCell(p.movement, p.cols.move, Math.round(fontSize * 0.7)),
  );
}

/** Variación de puesto con un triángulo dibujado (la tipografía no trae ▲▼). */
function movementCell(movement: number, width: number, size: number): VNode {
  if (movement === 0) return h('div', { width, justifyContent: 'center', color: palette.faint, fontFamily: fonts.display, fontSize: size }, '–');
  const up = movement > 0;
  const color = up ? palette.win : palette.loss;
  const tri = Math.round(size * 0.55);
  const points = up ? `0,${tri} ${tri},${tri} ${tri / 2},0` : `0,0 ${tri},0 ${tri / 2},${tri}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tri}" height="${tri}"><polygon points="${points}" fill="${color}"/></svg>`;
  return h(
    'div',
    { width, justifyContent: 'center', alignItems: 'center', gap: 4, color, fontFamily: fonts.display, fontWeight: 700, fontSize: size },
    img(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, { width: tri, height: tri }),
    String(Math.abs(movement)),
  );
}

export function tableHeader(cols: TableColumns, width: number, label: string): VNode {
  const cell = (text: string, w: number, align: 'flex-start' | 'center' = 'center') =>
    h('div', { width: w, justifyContent: align, fontFamily: fonts.display, fontWeight: 600, fontSize: 19, letterSpacing: 2, color: palette.faint }, text);
  return h(
    'div',
    { width, height: 34, alignItems: 'center', padding: '0 12px', borderLeft: '6px solid transparent' },
    cell('#', cols.pos),
    h('div', { width: cols.team, fontFamily: fonts.display, fontWeight: 700, fontSize: 22, letterSpacing: 2, color: palette.accent }, label.toUpperCase()),
    cell('PJ', cols.played),
    cell('DG', cols.diff),
    cell('PTS', cols.points),
    cols.form ? cell('ÚLTIMOS 5', cols.form) : null,
    cell('', cols.move),
  );
}
