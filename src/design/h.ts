// Nodos para satori sin JSX: h('div', estilo, ...hijos).
// Todo <div> es flex por defecto (satori lo exige cuando hay varios hijos) y usa
// box-sizing: border-box, para que el ancho declarado incluya relleno y borde.

export type Style = Record<string, string | number | undefined>;

export interface VNode {
  type: string;
  props: { style?: Style; children?: Child | Child[]; [key: string]: unknown };
}

export type Child = VNode | string | number | null | undefined | false;

export function h(type: string, style: Style = {}, ...children: (Child | Child[])[]): VNode {
  const flat = children.flat().filter((c): c is VNode | string | number => c !== null && c !== undefined && c !== false);
  const finalStyle = type === 'div' ? { display: 'flex', boxSizing: 'border-box', ...style } : style;
  return { type, props: { style: finalStyle, children: flat.length === 1 ? flat[0] : flat } };
}

export function img(src: string, style: Style): VNode {
  return { type: 'img', props: { src, style } };
}

/** Texto en una sola línea que se corta con "…" si no cabe. */
export function line(text: string, style: Style = {}): VNode {
  return h('div', { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...style }, text);
}
