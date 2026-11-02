import type { AppConfig } from '../core/config.ts';
import type { AnyView } from '../content/views.ts';
import type { BrandInfo } from '../design/components/brand.ts';
import type { LogoSet } from '../design/components/team.ts';
import { loadBrandLogo } from './renderer.ts';
import type { VNode } from '../design/h.ts';
import type { Format } from '../design/tokens.ts';
import { fixturesTemplate } from './templates/fixtures.ts';
import { h2hTemplate, previewSlides } from './templates/h2h.ts';
import { lineupSlides, lineupsTemplate } from './templates/lineups.ts';
import { resultTemplate } from './templates/result.ts';
import { scorersTemplate } from './templates/scorers.ts';
import { standingsTemplate } from './templates/standings.ts';
import { summaryTemplate } from './templates/summary.ts';
import { teamTemplate } from './templates/team.ts';

const brandLogos = new Map<string, LogoSet | undefined>();

export function brandFrom(config: AppConfig): BrandInfo {
  if (!brandLogos.has(config.rootDir)) brandLogos.set(config.rootDir, loadBrandLogo(config.rootDir));
  return { name: config.file.marca.nombre, handle: config.file.marca.usuario, disclaimer: config.file.marca.pie, logo: brandLogos.get(config.rootDir) };
}

export function templateFor(view: AnyView, format: Format, brand: BrandInfo): VNode {
  switch (view.kind) {
    case 'cartelera':
      return fixturesTemplate(view, format, brand);
    case 'resultado':
      return resultTemplate(view, format, brand);
    case 'resumen':
      return summaryTemplate(view, format, brand);
    case 'tabla':
      return standingsTemplate(view, format, brand);
    case 'goleadores':
      return scorersTemplate(view, format, brand);
    case 'equipo':
      return teamTemplate(view, format, brand);
    case 'duelo':
      return h2hTemplate(view, format, brand);
    case 'alineaciones':
      return lineupsTemplate(view, format, brand);
  }
}

/** Imágenes de una publicación: la previa y las alineaciones son carruseles; el resto, una sola imagen. */
export function slidesFor(view: AnyView, format: Format, brand: BrandInfo): VNode[] {
  if (view.kind === 'duelo') return previewSlides(view, format, brand);
  if (view.kind === 'alineaciones') return lineupSlides(view, format, brand);
  return [templateFor(view, format, brand)];
}
