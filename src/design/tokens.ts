// Sistema de diseño de Estadísticas EC: paleta, tipografía, espaciado, rejilla y formatos.
// Dirección visual: tema claro con los colores del logo — fondo claro azulado, texto azul
// marino, cifras condensadas grandes y un único acento azul.

export const palette = {
  // Tema claro con los colores del logo. Por compatibilidad, "ink" es el fondo y "paper" el texto.
  ink: '#f3f7fc',
  inkRaised: '#ffffff',
  inkHigh: '#e6eef8',
  line: '#d5e0ee',
  paper: '#0b1a33',
  muted: '#566a85',
  faint: '#8a9bb2',
  // Azul del logo, un punto más oscuro para que el texto pequeño se lea bien sobre fondo claro.
  accent: '#0a78db',
  onAccent: '#ffffff',
  /** Azul vivo del anillo del logo: brillos y detalles, no texto. */
  stadium: '#0a97f7',
  win: '#1a9e4b',
  draw: '#94a3b8',
  loss: '#e5484d',
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
