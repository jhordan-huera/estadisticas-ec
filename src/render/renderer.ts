// Render: nodos → SVG (satori) → PNG (resvg) y, para Instagram, JPEG (jpeg-js).
// Las fuentes se cargan una sola vez desde assets/fonts (licencia OFL).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import satori from 'satori';
import type { LogoSet } from '../design/components/team.ts';
import type { VNode } from '../design/h.ts';
import { fonts as fontFamilies, type Format } from '../design/tokens.ts';

type SatoriFont = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700 | 800; style: 'normal' };

const FONT_FILES: { file: string; name: string; weight: SatoriFont['weight'] }[] = [
  { file: 'Barlow-Regular.ttf', name: fontFamilies.text, weight: 400 },
  { file: 'Barlow-Medium.ttf', name: fontFamilies.text, weight: 500 },
  { file: 'Barlow-SemiBold.ttf', name: fontFamilies.text, weight: 600 },
  { file: 'Barlow-Bold.ttf', name: fontFamilies.text, weight: 700 },
  { file: 'BarlowCondensed-SemiBold.ttf', name: fontFamilies.display, weight: 600 },
  { file: 'BarlowCondensed-Bold.ttf', name: fontFamilies.display, weight: 700 },
  { file: 'BarlowCondensed-ExtraBold.ttf', name: fontFamilies.display, weight: 800 },
];

export interface RenderedImage {
  svg: string;
  png: Buffer;
  width: number;
  height: number;
}

export class Renderer {
  #fonts: SatoriFont[];

  constructor(fontsDir: string) {
    this.#fonts = FONT_FILES.map((f) => {
      const path = join(fontsDir, f.file);
      if (!existsSync(path)) throw new Error(`Falta la fuente ${path}`);
      return { name: f.name, data: readFileSync(path), weight: f.weight, style: 'normal' as const };
    });
  }

  async render(node: VNode, format: Format): Promise<RenderedImage> {
    const svg = await satori(node as unknown as Parameters<typeof satori>[0], {
      width: format.width,
      height: format.height,
      fonts: this.#fonts,
    });
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: format.width }, font: { loadSystemFonts: false } });
    const png = Buffer.from(resvg.render().asPng());
    return { svg, png, width: format.width, height: format.height };
  }

  /** JPEG para la API de Instagram (que solo acepta JPEG en imágenes). */
  static pngToJpeg(svg: string, width: number, quality = 92): Buffer {
    const image = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
    const encoded = jpeg.encode({ data: Buffer.from(image.pixels), width: image.width, height: image.height }, quality);
    return Buffer.from(encoded.data);
  }
}

/**
 * Logos autorizados opcionales: assets/logos/<ABREV>.png|.jpg → variantes por abreviatura.
 * Cada logo se reduce en pasos de la mitad (p. ej. 500 → 250 → 125 → 63): reducir de a poco
 * conserva mucha más nitidez que pasar de 500 px a 40 px de una vez.
 */
export function loadLogos(dir: string, enabled: boolean): Map<string, LogoSet> {
  const logos = new Map<string, LogoSet>();
  if (!enabled || !existsSync(dir)) return logos;
  const mime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
  for (const file of readdirSync(dir)) {
    const type = mime[extname(file).toLowerCase()];
    if (!type) continue;
    const bytes = readFileSync(join(dir, file));
    const original = `data:${type};base64,${bytes.toString('base64')}`;
    const width = type === 'image/png' && bytes.length > 24 ? bytes.readUInt32BE(16) : DEFAULT_LOGO_SIZE;
    const variants = [{ size: width, uri: original }];
    let current = original;
    for (let size = Math.round(width / 2); size >= LOGO_MIN; size = Math.round(size / 2)) {
      current = downscale(current, size);
      variants.push({ size, uri: current });
    }
    logos.set(basename(file, extname(file)).toUpperCase(), { variants });
  }
  return logos;
}

/** Tamaño supuesto cuando no se puede leer del archivo (JPEG). */
const DEFAULT_LOGO_SIZE = 500;
const LOGO_MIN = 60;

function downscale(uri: string, size: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}"><image href="${uri}" xlink:href="${uri}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" image-rendering="optimizeQuality"/></svg>`;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}
