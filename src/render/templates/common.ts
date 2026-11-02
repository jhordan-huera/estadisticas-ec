import { h, line, type VNode } from '../../design/h.ts';
import { fonts, palette, type, type Format } from '../../design/tokens.ts';

export function contentWidth(format: Format): number {
  return format.width - 2 * format.margin;
}

/** Alto disponible para el cuerpo dentro del marco (cabecera, título y pie descontados). */
export function bodyHeight(format: Format): number {
  return format.height <= 1080 ? 740 : 950;
}

export function isCompact(format: Format): boolean {
  return format.height <= 1080;
}

export function sectionLabel(text: string, opts: { color?: string; size?: number } = {}): VNode {
  return line(text.toUpperCase(), {
    fontFamily: fonts.display,
    fontWeight: 700,
    fontSize: opts.size ?? type.small,
    letterSpacing: 2.5,
    color: opts.color ?? palette.muted,
  });
}

export function dayHeader(label: string, width: number): VNode {
  return h(
    'div',
    { width, alignItems: 'center', gap: 16, height: 36 },
    sectionLabel(label, { color: palette.accent }),
    h('div', { flexGrow: 1, height: 1, backgroundColor: palette.line }),
  );
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
