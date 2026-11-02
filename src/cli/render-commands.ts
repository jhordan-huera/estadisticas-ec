// Comandos de render para revisar diseños con datos reales (sin publicar nada).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppContext } from '../app.ts';
import {
  createViewContext,
  fixturesView,
  headToHeadView,
  lineupsView,
  resultView,
  scorersView,
  standingsView,
  summaryView,
  teamStatsView,
  type AnyView,
} from '../content/views.ts';
import { writeCaption, type CopyContext } from '../copy/writer.ts';
import type { ViewContext } from '../content/views.ts';
import { formats, type Format } from '../design/tokens.ts';
import { brandFrom, slidesFor } from '../render/index.ts';
import { buildSite } from '../site/build.ts';
import { loadLogos, Renderer } from '../render/renderer.ts';
import { loadSeason } from '../stats/load.ts';
import { lastCompletedMatchday, matchdays, nextMatchday } from '../stats/matchday.ts';
import { tableRulesFor } from '../stats/verify.ts';
import { flagInt, flagString, type ParsedArgs } from './args.ts';
import { many } from '../db/connection.ts';
import { syncLineups } from '../sync/lineups.ts';

const out = (line = '') => process.stdout.write(line + '\n');

export function rendererFor(app: AppContext): Renderer {
  return new Renderer(resolve(app.config.rootDir, 'assets/fonts'));
}

export function viewContextFor(app: AppContext, code: string, year: number, withLogos = app.config.file.marca.usarLogos === true) {
  const data = loadSeason(app.db, code, year);
  const logos = loadLogos(resolve(app.config.rootDir, 'assets/logos'), withLogos);
  return createViewContext(data, tableRulesFor(app.config, code), logos, app.config.file.zonaHoraria);
}

export function copyContextFor(app: AppContext, view: ViewContext): CopyContext {
  const textos = app.config.file.textos ?? { hashtags: { base: [], equipos: true, maximo: 8 } };
  return { view, config: textos, disclaimer: app.config.file.marca.pie, teamOverrides: app.config.teams };
}

/** Vistas de muestra de los 7 tipos de contenido a partir de los datos guardados. */
async function sampleViews(app: AppContext, args: ParsedArgs): Promise<{ ctx: ViewContext; items: { name: string; view: AnyView }[] }> {
  const withLogos = args.flags.logos === true ? true : undefined;
  const code = flagString(args, 'competicion') ?? 'serie-a';
  const year = flagInt(args, 'temporada') ?? app.config.file.temporada;
  let ctx = viewContextFor(app, code, year, withLogos);
  const days = matchdays(ctx.data);
  const done = lastCompletedMatchday(days);
  const next = nextMatchday(days, new Date()) ?? days.at(-1);
  if (!done || !next) throw new Error('No hay fechas suficientes para generar muestras');
  // Resultado de muestra: el partido con más "historia" de la última fecha completa.
  const featured = [...done.matches].filter((m) => m.status === 'finished').sort((a, b) => (b.homeScore! + b.awayScore!) - (a.homeScore! + a.awayScore!))[0]!;
  const preview = next.core.find((m) => m.status === 'scheduled') ?? next.matches[0]!;
  const teamAbbr = flagString(args, 'equipo') ?? 'LDU';
  const team = [...ctx.data.teams.values()].find((t) => t.abbr === teamAbbr) ?? ctx.data.teams.get(featured.homeTeamId)!;
  // Alineaciones de muestra: las guardadas o, si no hay, las del partido de ejemplo ya jugado.
  let lineupMatch = ctx.data.matches.find((m) => (ctx.data.lineups.get(m.id)?.length ?? 0) === 2);
  if (!lineupMatch) {
    const ext = many<{ external_id: string }>(app.db, 'SELECT external_id FROM matches WHERE id = :id', { id: featured.id })[0]?.external_id;
    if (ext) await syncLineups(app, code, { matchExternalId: ext, season: year });
    ctx = viewContextFor(app, code, year, withLogos);
    lineupMatch = ctx.data.matches.find((m) => (ctx.data.lineups.get(m.id)?.length ?? 0) === 2);
  }
  const lineupDay = lineupMatch?.round != null ? days.find((d) => d.stageId === lineupMatch!.stageId && d.round === lineupMatch!.round) : undefined;
  return { ctx, items: [
    { name: '1-cartelera', view: fixturesView(ctx, next) },
    { name: '2-resultado', view: resultView(ctx, featured, done) },
    { name: '3-resumen', view: summaryView(ctx, done) },
    { name: '4-tabla', view: standingsView(ctx, done) },
    { name: '5-goleadores', view: scorersView(ctx) },
    { name: '6-equipo', view: teamStatsView(ctx, team.id) },
    { name: '7-duelo', view: headToHeadView(ctx, preview, next) },
    ...(lineupMatch ? [{ name: '8-alineaciones', view: lineupsView(ctx, lineupMatch, lineupDay) as AnyView }] : []),
  ] };
}

export const renderCommands = {
  sitio: (app: AppContext, args: ParsedArgs) => {
    const ctx = viewContextFor(app, flagString(args, 'competicion') ?? 'serie-a', flagInt(args, 'temporada') ?? app.config.file.temporada);
    const outDir = resolve(app.config.rootDir, flagString(args, 'salida') ?? join(app.config.env.outDir, 'sitio'));
    const { files } = buildSite(ctx, { outDir, brand: brandFrom(app.config), source: app.config.file.textos?.fuente ?? 'Datos: ESPN', now: new Date() });
    for (const f of files) out(`✓ ${f}`);
    return 0;
  },

  muestras: async (app: AppContext, args: ParsedArgs) => {
    const dir = resolve(app.config.env.outDir, args.flags.logos ? 'muestras-con-logos' : 'muestras');
    mkdirSync(dir, { recursive: true });
    const renderer = rendererFor(app);
    const brand = brandFrom(app.config);
    const which = flagString(args, 'formato');
    const selected: Format[] = which === 'vertical' ? [formats.vertical] : which === 'cuadrado' ? [formats.cuadrado] : [formats.vertical, formats.cuadrado];
    const { ctx, items } = await sampleViews(app, args);
    const copy = copyContextFor(app, ctx);
    for (const { name, view } of items) {
      const caption = writeCaption(view, copy);
      writeFileSync(join(dir, `${name}.txt`), caption.text + '\n');
      out(`✓ ${join(dir, `${name}.txt`)} [${caption.situation}]`);
      for (const w of caption.warnings) out(`  ⚠ ${w}`);
      for (const format of selected) {
        const slides = slidesFor(view, format, brand);
        for (const [i, slide] of slides.entries()) {
          const started = Date.now();
          const image = await renderer.render(slide, format);
          const file = join(dir, `${name}-${format.id}${slides.length > 1 ? `-${i + 1}` : ''}.png`);
          writeFileSync(file, image.png);
          out(`✓ ${file} (${Math.round(image.png.length / 1024)} KB, ${Date.now() - started} ms)`);
        }
      }
    }
    return 0;
  },
};
