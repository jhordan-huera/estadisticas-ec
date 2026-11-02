// Sistema de diseño de Estadísticas EC: paleta, tipografía, espaciado, rejilla y formatos.
// Dirección visual: "marcador nocturno" — fondo tinta, cifras condensadas grandes y
// un único acento lima tipo LED. Ningún elemento imita marcas de la liga ni de clubes.

export const palette = {
  ink: '#0d1117',
  inkRaised: '#151c26',
  inkHigh: '#1d2632',
  line: '#263140',
  paper: '#f3f1ea',
  muted: '#8d98a7',
  faint: '#5d6878',
  accent: '#c8f31d',
  onAccent: '#0d1117',
  win: '#c8f31d',
  draw: '#8d98a7',
  loss: '#ff5d5d',
  red: '#e5383b',
  yellow: '#f5c518',
  neutralTeam: '#3a4655',
} as const;

export const fonts = {
  display: 'Barlow Condensed',
  text: 'Barlow',
} as const;

/** Escala tipográfica (px) pensada para lectura en móvil a 1080 de ancho. */
export const type = {
  hero: 168,
  title: 92,
  headline: 56,
  big: 44,
  body: 30,
  small: 24,
  micro: 20,
} as const;

/** Espaciado en múltiplos de 8. */
export const space = (n: number) => n * 8;

export const radius = { sm: 10, md: 16, lg: 24 } as const;

export interface Format {
  id: 'vertical' | 'cuadrado';
  width: number;
  height: number;
  margin: number;
}

export const formats: Record<Format['id'], Format> = {
  vertical: { id: 'vertical', width: 1080, height: 1350, margin: 64 },
  cuadrado: { id: 'cuadrado', width: 1080, height: 1080, margin: 56 },
};

/** Rejilla de 12 columnas: ancho de n columnas (con sus medianiles) dentro de los márgenes. */
export function columns(format: Format, n: number, gutter = 24): number {
  const col = (format.width - 2 * format.margin - 11 * gutter) / 12;
  return Math.round(n * col + (n - 1) * gutter);
}
