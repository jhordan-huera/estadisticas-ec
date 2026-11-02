// Satori no reduce el texto automáticamente: estimamos el ancho por carácter de cada
// familia para elegir un tamaño que quepa. Factores medidos sobre Barlow / Barlow Condensed.

const WIDTH_FACTOR = {
  display: 0.47, // Barlow Condensed, mayúsculas en negrita
  text: 0.55, // Barlow
} as const;

export function estimateWidth(text: string, size: number, family: keyof typeof WIDTH_FACTOR): number {
  return text.length * size * WIDTH_FACTOR[family];
}

/** Mayor tamaño entre `min` y `max` con el que el texto cabe en `width`. */
export function fitSize(text: string, width: number, max: number, min: number, family: keyof typeof WIDTH_FACTOR): number {
  const ideal = width / (Math.max(1, text.length) * WIDTH_FACTOR[family]);
  return Math.max(min, Math.min(max, Math.floor(ideal)));
}
