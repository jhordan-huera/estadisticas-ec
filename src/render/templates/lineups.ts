// 8. Alineaciones confirmadas: carrusel con una imagen por equipo, primero el local.
// Cada equipo ocupa la cancha entera atacando hacia arriba (arquero abajo, delanteros arriba)
// y debajo van sus suplentes.

import type { LineupKit, LineupSide, LineupsView } from '../../content/views.ts';
import { frame, type BrandInfo } from '../../design/components/brand.ts';
import { chip } from '../../design/components/stats.ts';
import { teamMark } from '../../design/components/team.ts';
import { luminance, withAlpha } from '../../design/color.ts';
import { h, img, line, type VNode } from '../../design/h.ts';
import { estimateWidth, fitSize } from '../../design/text-fit.ts';
import { fonts, palette, type, type Format } from '../../design/tokens.ts';
import { bodyHeight, capitalize, contentWidth, isCompact } from './common.ts';

const GRASS = '#d6ecdc';
const GRASS_STRIPE = '#cde6d4';
const CHALK = 'rgba(255, 255, 255, 0.95)';
const KICKER_SPACING = 3;

export function lineupSlides(view: LineupsView, format: Format, brand: BrandInfo): VNode[] {
  return [
    teamSlide(view, view.home, view.away, 'local', 1, format, brand),
    teamSlide(view, view.away, view.home, 'visitante', 2, format, brand),
  ];
}

/** Compatibilidad con el render de una sola imagen: la del local. */
export function lineupsTemplate(view: LineupsView, format: Format, brand: BrandInfo): VNode {
  return lineupSlides(view, format, brand)[0]!;
}

function teamSlide(view: LineupsView, side: LineupSide, rival: LineupSide, label: string, n: number, format: Format, brand: BrandInfo): VNode {
  const width = contentWidth(format);
  const compact = isCompact(format);
  const stripHeight = compact ? 56 : 72;
  const gap = compact ? 10 : 14;
  const benchHeight = side.bench.length ? (compact ? 84 : 110) : 0;
  const pitchHeight = bodyHeight(format) - stripHeight - gap - (benchHeight ? gap + benchHeight : 0);

  const body = [
    strip(side, rival, width, stripHeight),
    h('div', { height: gap }),
    pitch(side, width, pitchHeight, compact),
    benchHeight ? h('div', { height: gap }) : null,
    benchHeight ? bench(side, width, benchHeight, compact) : null,
  ];
  return frame({ format, brand, competition: view.competition, kicker: kickerFor(view, n, width), title: `Alineación ${label}`, titleAccent: label, body });
}

/** Fecha, día y hora con el contador del carrusel; si no cabe, se omite el día de la semana. */
function kickerFor(view: LineupsView, n: number, width: number): string {
  const pager = `${n}/2`;
  const full = [view.kicker, `${capitalize(view.dateLabel)} ${view.time}`, pager].filter(Boolean).join(' · ');
  const size = type.small + 2;
  if (estimateWidth(full, size, 'display') + full.length * KICKER_SPACING <= width) return full;
  return [view.kicker, view.time, pager].filter(Boolean).join(' · ');
}

function strip(side: LineupSide, rival: LineupSide, width: number, height: number): VNode {
  const mark = height - 8;
  return h(
    'div',
    { width, height, alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', flexShrink: 0 },
    h(
      'div',
      { alignItems: 'center', gap: 16 },
      teamMark(side.team, mark),
      line(side.team.shortName, { fontFamily: fonts.display, fontWeight: 800, fontSize: fitSize(side.team.shortName, width * 0.42, height * 0.72, 26, 'display'), color: palette.paper }),
      side.formation ? chip(side.formation, 'accent', type.micro + 4) : null,
    ),
    h(
      'div',
      { alignItems: 'center', gap: 10, maxWidth: width * 0.36 },
      line('VS', { fontFamily: fonts.display, fontWeight: 600, fontSize: type.micro, letterSpacing: 2, color: palette.muted }),
      teamMark(rival.team, Math.round(height * 0.5)),
      line(rival.team.shortName, { fontFamily: fonts.display, fontWeight: 700, fontSize: type.micro + 4, color: palette.muted }),
    ),
  );
}

function pitch(side: LineupSide, W: number, H: number, compact: boolean): VNode {
  const inset = 14;
  const chalk = 3;
  const abs = (style: Record<string, string | number>) => h('div', { position: 'absolute', ...style });
  const stripes = Array.from({ length: 10 }, (_, i) =>
    abs({ left: 0, top: (H / 10) * i, width: W, height: H / 10, backgroundColor: i % 2 ? GRASS_STRIPE : GRASS }),
  );
  const boxW = W * 0.46;
  const boxH = H * 0.13;
  const smallW = W * 0.22;
  const smallH = H * 0.055;
  const circle = H * 0.2;
  const lines = [
    abs({ left: inset, top: inset, width: W - 2 * inset, height: H - 2 * inset, border: `${chalk}px solid ${CHALK}`, borderRadius: 6 }),
    abs({ left: inset, top: H / 2 - chalk / 2, width: W - 2 * inset, height: chalk, backgroundColor: CHALK }),
    abs({ left: W / 2 - circle / 2, top: H / 2 - circle / 2, width: circle, height: circle, border: `${chalk}px solid ${CHALK}`, borderRadius: 999 }),
    abs({ left: (W - boxW) / 2, top: inset, width: boxW, height: boxH, border: `${chalk}px solid ${CHALK}`, borderTop: 'none' }),
    abs({ left: (W - smallW) / 2, top: inset, width: smallW, height: smallH, border: `${chalk}px solid ${CHALK}`, borderTop: 'none' }),
    abs({ left: (W - boxW) / 2, top: H - inset - boxH, width: boxW, height: boxH, border: `${chalk}px solid ${CHALK}`, borderBottom: 'none' }),
    abs({ left: (W - smallW) / 2, top: H - inset - smallH, width: smallW, height: smallH, border: `${chalk}px solid ${CHALK}`, borderBottom: 'none' }),
  ];
  const size = compact ? 54 : 70;
  return h(
    'div',
    { position: 'relative', width: W, height: H, flexShrink: 0, borderRadius: 18, overflow: 'hidden', border: `1px solid ${palette.line}` },
    [...stripes, ...lines, ...placePlayers(side, W, H, size)],
  );
}

/** El arquero junto al arco de abajo y cada línea más arriba; dentro de la fila, de banda izquierda a derecha. */
function placePlayers(side: LineupSide, W: number, H: number, baseSize: number): VNode[] {
  // El apellido va debajo de la camiseta: la fila del arquero se sube para que no toque el borde.
  const bottom = H - H * 0.06 - baseSize * 1.25;
  const top = H * 0.13;
  const step = (bottom - top) / Math.max(1, side.rows.length - 1);
  // Con muchas líneas (4-1-2-1-2) se achican las camisetas para que no se pisen.
  const size = Math.min(baseSize, Math.floor((step - 6) / 1.95));
  const shirt = shirtSize(size);
  const nameSize = uniformNameSize(side, W, Math.round(size * 0.46), Math.round(size * 0.3));
  const nodes: VNode[] = [];
  side.rows.forEach((row, i) => {
    const y = bottom - i * step;
    const slot = Math.min(260, (2 * W) / (row.length + 1));
    row.forEach((p, j) => {
      const x = (W * (j + 1)) / (row.length + 1);
      nodes.push(
        h(
          'div',
          { position: 'absolute', left: x - slot / 2, top: y - shirt.height / 2, width: slot, flexDirection: 'column', alignItems: 'center', gap: 5 },
          jersey(side.kit, p.jersey, size),
          line(p.name, {
            maxWidth: slot,
            padding: `2px ${LABEL_PADDING / 2}px`,
            borderRadius: 7,
            backgroundColor: withAlpha('#ffffff', 0.94),
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: nameSize,
            color: palette.paper,
          }),
        ),
      );
    });
  });
  return nodes;
}

const LABEL_PADDING = 18;
const LABEL_GAP = 10;

/**
 * Un solo tamaño de apellido para todo el equipo (tamaños dispares se ven desprolijos): el mayor
 * con el que ninguna etiqueta pisa a su vecina de fila ni se sale de la cancha.
 */
function uniformNameSize(side: LineupSide, W: number, max: number, min: number): number {
  const perPoint = (name: string) => estimateWidth(name, 1, 'display');
  let size = max;
  for (const row of side.rows) {
    const spacing = W / (row.length + 1);
    for (let j = 0; j + 1 < row.length; j++) {
      const chars = (perPoint(row[j]!.name) + perPoint(row[j + 1]!.name)) / 2;
      size = Math.min(size, (spacing - LABEL_PADDING - LABEL_GAP) / chars);
    }
    for (const p of [row[0], row[row.length - 1]]) {
      if (p) size = Math.min(size, (2 * (spacing - LABEL_GAP) - LABEL_PADDING) / perPoint(p.name));
    }
  }
  return Math.max(min, Math.floor(size));
}

// Silueta de camiseta (cuello redondo y mangas cortas) en una caja de 100 × 100.
const SHIRT_PATH = 'M34 8 L8 24 L17 42 L26 36 L26 94 L74 94 L74 36 L83 42 L92 24 L66 8 Q50 22 34 8 Z';
const COLLAR_PATH = 'M34 8 Q50 22 66 8';

function shirtSize(size: number): { width: number; height: number } {
  return { width: Math.round(size * 1.3), height: Math.round(size * 1.25) };
}

/** Camiseta con los colores del partido; el dorsal va encima con la tipografía de la marca. */
function jersey(kit: LineupKit, number: string | null, size: number): VNode {
  const { width, height } = shirtSize(size);
  // Una camiseta clara (blanca, celeste) se perdería sobre el césped con borde blanco.
  const outline = luminance(kit.fill) > 0.6 ? palette.muted : '#ffffff';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${width}" height="${height}" preserveAspectRatio="none">` +
    `<path d="${SHIRT_PATH}" fill="${kit.fill}" stroke="${outline}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="${COLLAR_PATH}" fill="none" stroke="${kit.trim}" stroke-width="4" stroke-linecap="round"/></svg>`;
  return h(
    'div',
    { position: 'relative', width, height, flexShrink: 0 },
    img(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, { position: 'absolute', left: 0, top: 0, width, height }),
    // Ambos en posición absoluta: así el número se pinta encima de la camiseta.
    h(
      'div',
      { position: 'absolute', left: 0, top: Math.round(height * 0.31), width, justifyContent: 'center', fontFamily: fonts.display, fontWeight: 800, fontSize: Math.round(size * 0.52), lineHeight: 1, color: kit.number },
      number ?? '',
    ),
  );
}

/** Suplentes en texto corrido; el tamaño baja hasta que la lista entra en el espacio. */
function bench(side: LineupSide, width: number, height: number, compact: boolean): VNode {
  // Espacios duros dentro de cada nombre para que "De La Cruz" no se parta entre dos líneas.
  const names = side.bench.map((p) => (p.jersey ? `${p.jersey} ${p.name}` : p.name).replaceAll(' ', '\u00a0')).join(' · ');
  const labelSize = type.micro;
  const room = height - labelSize - 8;
  let size = compact ? 20 : 24;
  while (size > 14 && Math.ceil(estimateWidth(names, size, 'text') / (width * 0.95)) * size * 1.3 > room) size--;
  return h(
    'div',
    { width, height, flexDirection: 'column', gap: 6, flexShrink: 0, overflow: 'hidden' },
    line('SUPLENTES', { fontFamily: fonts.display, fontWeight: 600, fontSize: labelSize, letterSpacing: 2, color: palette.accent }),
    h('div', { width, fontSize: size, lineHeight: 1.3, color: palette.paper }, names),
  );
}
