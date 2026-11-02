// Sistema de diseño de Estadísticas EC: paleta, tipografía, espaciado, rejilla y formatos.
// Dirección visual: "estadio de noche", con los colores del logo — fondo negro azulado con
// el brillo azul de los focos, cifras condensadas grandes y un único acento verde neón.

export const palette = {
  // Colores tomados del logo de la marca: negro azulado, verde neón y azul de estadio.
  ink: '#060b10',
  inkRaised: '#0d1620',
  inkHigh: '#15212d',
  line: '#1f2d3b',
  paper: '#f4f7f5',
  muted: '#8e9cab',
  faint: '#5f6e7e',
  accent: '#7cfb04',
  onAccent: '#061003',
  stadium: '#2768a4',
  win: '#7cfb04',
  draw: '#8e9cab',
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
