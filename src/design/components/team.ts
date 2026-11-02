// Identificación de equipos sin logos: abreviatura sobre su color principal.
// Si existe un logo autorizado en assets/logos y está habilitado, se usa en su lugar.

import { readableOn, withAlpha, luminance } from '../color.ts';
import { h, img, line, type VNode } from '../h.ts';
import { fonts, palette } from '../tokens.ts';

/**
 * Logo en varias resoluciones (de mayor a menor). Reducir un escudo detallado de 500 px
 * a 40 px de una sola vez pierde nitidez; se elige la variante más cercana al tamaño final.
 */
export interface LogoSet {
  variants: { size: number; uri: string }[];
}

export interface TeamVisual {
  id: number;
  name: string;
  shortName: string;
  abbr: string;
  color: string;
  textColor: string;
  /** Logo autorizado (opcional). */
  logo?: LogoSet;
}

/** La variante debe tener al menos el doble del tamaño de dibujo (cubre la exportación a 1440 px). */
const LOGO_OVERSAMPLE = 2;

export function pickLogoVariant(logo: LogoSet, size: number): string {
  const sorted = [...logo.variants].sort((a, b) => a.size - b.size);
  return (sorted.find((v) => v.size >= size * LOGO_OVERSAMPLE) ?? sorted.at(-1)!).uri;
}

export function teamMark(team: TeamVisual, size: number): VNode {
  if (team.logo) {
    return h('div', { width: size, height: size, alignItems: 'center', justifyContent: 'center' }, img(pickLogoVariant(team.logo, size), { width: size, height: size, objectFit: 'contain' }));
  }
  // Los colores muy oscuros o muy claros llevan un borde sutil para separarse del fondo.
  const lum = luminance(team.color);
  const border = lum < 0.04 ? `2px solid ${withAlpha(palette.paper, 0.18)}` : lum > 0.85 ? `2px solid ${withAlpha('#000000', 0.25)}` : '2px solid transparent';
  return h(
    'div',
    {
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.24),
      backgroundColor: team.color,
      border,
      alignItems: 'center',
      justifyContent: 'center',
      color: team.textColor,
      fontFamily: fonts.display,
      fontWeight: 800,
      fontSize: Math.round(size * (team.abbr.length > 3 ? 0.32 : 0.4)),
      letterSpacing: 0.5,
    },
    team.abbr,
  );
}

/** Marca + nombre, alineados a la izquierda o a la derecha. */
export function teamLabel(team: TeamVisual, opts: { size: number; fontSize: number; align: 'left' | 'right'; width: number; full?: boolean }): VNode {
  const name = line(opts.full ? team.name : team.shortName, {
    fontFamily: fonts.display,
    fontWeight: 700,
    fontSize: opts.fontSize,
    color: palette.paper,
    maxWidth: opts.width - opts.size - 20,
    textAlign: opts.align,
  });
  return h(
    'div',
    { width: opts.width, alignItems: 'center', gap: 20, justifyContent: opts.align === 'left' ? 'flex-start' : 'flex-end' },
    opts.align === 'left' ? [teamMark(team, opts.size), name] : [name, teamMark(team, opts.size)],
  );
}

export function visualFor(team: { id: number; name: string; shortName: string; abbr: string; color: string | null; textColor: string | null }, logo?: LogoSet): TeamVisual {
  const color = team.color ?? palette.neutralTeam;
  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    abbr: team.abbr,
    color,
    textColor: team.textColor ?? readableOn(color),
    logo,
  };
}
