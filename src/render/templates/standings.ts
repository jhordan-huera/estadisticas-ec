// 4. Tabla de posiciones (una o varias tablas de grupo).
// En formato cuadrado con muchas filas, las tablas se reparten en dos columnas para
// mantener un tamaño de letra legible en el móvil.

import type { StandingsView } from '../../content/views.ts';
import { frame, type BrandInfo } from '../../design/components/brand.ts';
import { tableColumns, tableHeader, tableRow, uniformNameSize } from '../../design/components/table.ts';
import { h, type VNode } from '../../design/h.ts';
import type { Format } from '../../design/tokens.ts';
import { bodyHeight, contentWidth, isCompact } from './common.ts';

type Table = StandingsView['tables'][number];

const HEADER_BLOCK = 34 + 12;
const ROW_GAP = 2;

export function standingsTemplate(view: StandingsView, format: Format, brand: BrandInfo): VNode {
  const width = contentWidth(format);
  const totalRows = view.tables.reduce((n, t) => n + t.rows.length, 0);
  const twoColumns = isCompact(format) && view.tables.length > 1 && totalRows > 12;
  const columns = twoColumns ? splitColumns(view.tables) : [view.tables];
  const columnWidth = twoColumns ? Math.floor((width - 24) / 2) : width;

  const rowsInTallest = Math.max(...columns.map((col) => col.reduce((n, t) => n + t.rows.length, 0)));
  const headersInTallest = columns.find((col) => col.reduce((n, t) => n + t.rows.length, 0) === rowsInTallest)!.length;
  const rowHeight = Math.max(32, Math.min(64, Math.floor((bodyHeight(format) - headersInTallest * HEADER_BLOCK - rowsInTallest * ROW_GAP) / Math.max(1, rowsInTallest))));
  const cols = tableColumns(columnWidth, rowHeight >= 44);
  const nameSize = uniformNameSize(view.tables.flatMap((t) => t.rows.map((r) => r.team)), cols, rowHeight);

  const renderTable = (t: Table) =>
    h(
      'div',
      { flexDirection: 'column', gap: ROW_GAP, marginBottom: 12 },
      tableHeader(cols, columnWidth, view.tables.length > 1 ? t.label : 'Equipo'),
      t.rows.map((r, i) =>
        tableRow({
          position: r.position,
          team: r.team,
          played: r.played,
          goalDiff: r.goalDiff,
          points: r.points,
          form: r.form,
          movement: r.movement,
          height: rowHeight,
          width: columnWidth,
          cols,
          zone: r.position === 1 ? 'leader' : 'none',
          striped: i % 2 === 1,
          nameSize,
        }),
      ),
    );

  const body = twoColumns
    ? h('div', { gap: 24, width }, columns.map((col) => h('div', { flexDirection: 'column', width: columnWidth }, col.map(renderTable))))
    : view.tables.map(renderTable);

  return frame({ format, brand, competition: view.competition, kicker: view.kicker, title: 'Tabla de posiciones', titleAccent: 'posiciones', body });
}

/** Reparte las tablas en dos columnas equilibrando el número de filas, sin partir ninguna tabla. */
function splitColumns(tables: Table[]): Table[][] {
  const total = tables.reduce((n, t) => n + t.rows.length, 0);
  let best: Table[][] = [tables, []];
  let bestDiff = Infinity;
  for (let cut = 1; cut < tables.length; cut++) {
    const left = tables.slice(0, cut).reduce((n, t) => n + t.rows.length, 0);
    const diff = Math.abs(total - 2 * left);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = [tables.slice(0, cut), tables.slice(cut)];
    }
  }
  return best;
}
