// Marco común de todas las piezas: cabecera de marca, título, cuerpo y pie legal.

import { withAlpha } from '../color.ts';
import { h, img, line, type Child, type VNode } from '../h.ts';
import { fonts, palette, space, type, type Format } from '../tokens.ts';
import { pickLogoVariant, type LogoSet } from './team.ts';

export interface BrandInfo {
  name: string;
  handle: string;
  disclaimer: string;
  /** Logo de la marca (se muestra al pie de cada pieza). */
  logo?: LogoSet;
}

export interface FrameProps {
  format: Format;
  brand: BrandInfo;
  /** "SERIE A ECUADOR 2026" */
  competition: string;
  /** Texto pequeño sobre el título: "FASE FINAL · FECHA 5" */
  kicker: string;
  title: string;
  /** Parte del título que se pinta con el acento. */
  titleAccent?: string;
  body: Child | Child[];
}

export function wordmark(brand: BrandInfo, size = 34): VNode {
  // "ESTADÍSTICAS EC" → "ESTADÍSTICAS" en papel + "EC" en bloque lima, como un dígito de marcador.
  const [first, ...rest] = brand.name.toUpperCase().split(' ');
  const tail = rest.join(' ');
  return h(
    'div',
    { alignItems: 'center', gap: 10, fontFamily: fonts.display, fontWeight: 800, fontSize: size, letterSpacing: 1, color: palette.paper },
    h('div', {}, first ?? ''),
    tail ? h('div', { backgroundColor: palette.accent, color: palette.onAccent, padding: '0 10px', borderRadius: 6, lineHeight: 1.15 }, tail) : null,
  );
}

export function frame(p: FrameProps): VNode {
  const { format } = p;
  const compact = format.height <= 1080;
  return h(
    'div',
    {
      width: format.width,
      height: format.height,
      flexDirection: 'column',
      backgroundColor: palette.ink,
      // Brillo azul arriba, como los focos del estadio del logo, que se apaga hacia abajo.
      backgroundImage: `radial-gradient(ellipse 90% 45% at 50% 0%, ${withAlpha(palette.stadium, 0.32)} 0%, ${withAlpha(palette.stadium, 0)} 100%), linear-gradient(180deg, ${palette.ink} 0%, #08111a 100%)`,
      color: palette.paper,
      fontFamily: fonts.text,
      padding: `${compact ? space(5) : space(6)}px ${format.margin}px ${space(4)}px`,
    },
    // Filete superior de acento
    h('div', { position: 'absolute', top: 0, left: 0, width: format.width, height: 8, backgroundColor: palette.accent }),
    h(
      'div',
      { justifyContent: 'space-between', alignItems: 'center' },
      wordmark(p.brand, compact ? 30 : 34),
      line(p.competition.toUpperCase(), { fontFamily: fonts.display, fontWeight: 600, fontSize: type.small, letterSpacing: 2, color: palette.muted }),
    ),
    h(
      'div',
      { flexDirection: 'column', marginTop: compact ? space(3) : space(5), marginBottom: compact ? space(2) : space(4) },
      line(p.kicker.toUpperCase(), { fontFamily: fonts.display, fontWeight: 600, fontSize: type.small + 2, letterSpacing: 3, color: palette.accent }),
      title(p.title, p.titleAccent, compact ? type.title - 20 : type.title),
    ),
    h('div', { flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }, p.body),
    footer(p.brand),
  );
}

function title(text: string, accent: string | undefined, size: number): VNode {
  const upper = text.toUpperCase();
  const acc = accent?.toUpperCase();
  const style = { fontFamily: fonts.display, fontWeight: 800, fontSize: size, lineHeight: 0.95, letterSpacing: -0.5 };
  if (!acc || !upper.includes(acc)) return line(upper, style);
  const at = upper.lastIndexOf(acc);
  const before = upper.slice(0, at);
  const after = upper.slice(at + acc.length);
  return h(
    'div',
    { ...style, whiteSpace: 'nowrap' },
    before ? h('div', { marginRight: before.endsWith(' ') ? 18 : 0 }, before.trimEnd()) : null,
    h('div', { color: palette.accent }, acc),
    after ? h('div', { marginLeft: after.startsWith(' ') ? 18 : 0 }, after.trimStart()) : null,
  );
}

const FOOTER_LOGO = 60;

function footer(brand: BrandInfo): VNode {
  return h(
    'div',
    {
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTop: `1px solid ${palette.line}`,
      paddingTop: space(1.5),
      marginTop: space(2),
      fontSize: type.micro,
      color: palette.faint,
    },
    line(brand.disclaimer, { maxWidth: 640 }),
    h(
      'div',
      { alignItems: 'center', gap: 14 },
      line(brand.handle, { fontFamily: fonts.display, fontWeight: 700, fontSize: type.small, color: palette.muted }),
      brand.logo ? img(pickLogoVariant(brand.logo, FOOTER_LOGO), { width: FOOTER_LOGO, height: FOOTER_LOGO }) : null,
    ),
  );
}
