// Flujo de publicación en tres pasos independientes (para poder hacer "push" de las
// imágenes entre generar y publicar, como exige la API de Instagram):
//   planificar → encola candidatos (idempotente)
//   generar    → dibuja imagen y texto de lo pendiente
//   publicar   → publica lo generado, por prioridad y sin pasar el límite diario

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppContext } from '../app.ts';
import type { PostKind } from '../core/config.ts';
import { describeError } from '../core/errors.ts';
import { localToday } from '../core/time.ts';
import {
  fixturesView,
  headToHeadView,
  resultView,
  scorersView,
  standingsView,
  summaryView,
  teamStatsView,
  type AnyView,
  type ViewContext,
} from '../content/views.ts';
import { writeCaption, type CopyContext } from '../copy/writer.ts';
import { formats } from '../design/tokens.ts';
import { createPublisher, publicUrlFor } from '../publish/factory.ts';
import { PublishError } from '../publish/types.ts';
import { brandFrom, slidesFor } from '../render/index.ts';
import { loadLogos, Renderer } from '../render/renderer.ts';
import { loadSeason } from '../stats/load.ts';
import { lastCompletedMatchday, matchdays } from '../stats/matchday.ts';
import { tableRulesFor } from '../stats/verify.ts';
import { createViewContext } from '../content/views.ts';
import { findMatchday, planCandidates, type Subject } from './planner.ts';
import { PostQueue, type MediaFile, type PostRow } from './queue.ts';

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Contextos de vista por competición, cargados una vez por ejecución. */
class Contexts {
  #app: AppContext;
  #cache = new Map<string, ViewContext>();

  constructor(app: AppContext) {
    this.#app = app;
  }

  get(code: string, season: number): ViewContext {
    const key = `${code}:${season}`;
    let ctx = this.#cache.get(key);
    if (!ctx) {
      const { config } = this.#app;
      const logos = loadLogos(resolve(config.rootDir, 'assets/logos'), config.file.marca.usarLogos === true);
      ctx = createViewContext(loadSeason(this.#app.db, code, season), tableRulesFor(config, code), logos, config.file.zonaHoraria);
      this.#cache.set(key, ctx);
    }
    return ctx;
  }
}

export interface PlanSummary {
  competition: string;
  candidates: number;
  inserted: number;
  superseded: number;
  error?: string;
}

export function planPosts(app: AppContext, now: Date, season = app.config.file.temporada): PlanSummary[] {
  const queue = new PostQueue(app.db);
  const contexts = new Contexts(app);
  const snapshots = queue.snapshots();
  const results: PlanSummary[] = [];
  for (const [code, kinds] of Object.entries(app.config.file.publicacion.competiciones)) {
    try {
      const candidates = planCandidates({ ctx: contexts.get(code, season), now, kinds: new Set(kinds), config: app.config.file.publicacion, snapshots });
      let inserted = 0;
      let superseded = 0;
      for (const c of candidates) {
        const res = queue.enqueue(c);
        if (res.inserted) {
          inserted++;
          app.logger.info(`Encolada: ${c.dedupeKey} (${c.reason})`);
        }
        superseded += res.superseded;
      }
      results.push({ competition: code, candidates: candidates.length, inserted, superseded });
    } catch (err) {
      const error = describeError(err);
      app.logger.error(`No se pudo planificar ${code}: ${error}`);
      results.push({ competition: code, candidates: 0, inserted: 0, superseded: 0, error });
    }
  }
  return results;
}

export interface RenderSummary {
  rendered: number;
  failed: number;
  expired: number;
}

export async function renderQueue(app: AppContext, now: Date): Promise<RenderSummary> {
  const { config, logger } = app;
  const queue = new PostQueue(app.db);
  const expired = queue.expire(iso(now));
  const contexts = new Contexts(app);
  const renderer = new Renderer(resolve(config.rootDir, 'assets/fonts'));
  const brand = brandFrom(config);
  const publishFormat = config.file.publicacion.formato;
  const summary: RenderSummary = { rendered: 0, failed: 0, expired };

  for (const post of queue.toRender(iso(now))) {
    try {
      const ctx = contexts.get(post.competition_code, post.season);
      const view = buildView(ctx, post.kind, JSON.parse(post.subject) as Subject);
      const copy: CopyContext = {
        view: ctx,
        config: config.file.textos ?? { hashtags: { base: [], equipos: true, maximo: 8 } },
        disclaimer: config.file.marca.pie,
        teamOverrides: config.teams,
      };
      const caption = writeCaption(view, copy);
      const dir = join(config.env.mediaDir, localToday(now, config.file.zonaHoraria));
      mkdirSync(dir, { recursive: true });
      const stem = post.dedupe_key.replace(/[^a-z0-9-]+/gi, '_');
      const media: MediaFile[] = [];
      for (const id of config.file.publicacion.formatosRender) {
        const format = formats[id];
        const slides = slidesFor(view, format, brand);
        for (const [i, slide] of slides.entries()) {
          const suffix = slides.length > 1 ? `-${i + 1}` : '';
          const image = await renderer.render(slide, format);
          const png = join(dir, `${stem}-${id}${suffix}.png`);
          writeFileSync(png, image.png);
          const file: MediaFile = { format: id, slide: i + 1, png };
          if (id === publishFormat) {
            file.jpg = join(dir, `${stem}-${id}${suffix}.jpg`);
            writeFileSync(file.jpg, Renderer.pngToJpeg(image.svg, config.file.publicacion.anchoInstagram ?? format.width));
          }
          media.push(file);
        }
      }
      writeFileSync(join(dir, `${stem}.txt`), caption.text + '\n');
      const fingerprint = view.kind === 'tabla' || view.kind === 'goleadores' ? view.fingerprint : undefined;
      queue.markRendered(post.id, { caption: caption.text, altText: caption.altText, situation: caption.situation, media, fingerprint });
      summary.rendered++;
      logger.info(`Generada: ${post.dedupe_key} [${caption.situation}]`);
    } catch (err) {
      summary.failed++;
      const status = queue.markFailed(post.id, describeError(err), true, 'render');
      logger.error(`No se pudo generar ${post.dedupe_key}: ${describeError(err)} → ${status}`);
    }
  }
  return summary;
}

export function buildView(ctx: ViewContext, kind: PostKind, subject: Subject): AnyView {
  const days = matchdays(ctx.data);
  const matchOf = (s: Subject) => {
    if (!('matchId' in s)) throw new Error('La publicación no indica el partido');
    const m = ctx.data.matches.find((x) => x.id === s.matchId);
    if (!m) throw new Error(`El partido ${s.matchId} ya no existe en los datos`);
    return m;
  };
  const dayOf = (s: Subject) => {
    if (!('stageId' in s)) throw new Error('La publicación no indica la fecha');
    const d = findMatchday(days, s.stageId, s.round);
    if (!d) throw new Error(`La fecha ${s.round} (fase ${s.stageId}) ya no existe en los datos`);
    return d;
  };
  switch (kind) {
    case 'resultado': {
      const m = matchOf(subject);
      if (m.status !== 'finished') throw new Error(`El partido ${m.id} ya no figura como finalizado (${m.status})`);
      return resultView(ctx, m, m.round !== null ? findMatchday(days, m.stageId, m.round) : undefined);
    }
    case 'duelo': {
      const m = matchOf(subject);
      return headToHeadView(ctx, m, m.round !== null ? findMatchday(days, m.stageId, m.round) : undefined);
    }
    case 'cartelera':
      return fixturesView(ctx, dayOf(subject));
    case 'resumen':
      return summaryView(ctx, dayOf(subject));
    case 'tabla':
      return standingsView(ctx, lastCompletedMatchday(days));
    case 'goleadores':
      return scorersView(ctx);
    case 'equipo':
      if (!('teamId' in subject)) throw new Error('La publicación no indica el equipo');
      return teamStatsView(ctx, subject.teamId);
  }
}

export interface PublishSummary {
  mode: string;
  published: number;
  failed: number;
  remainingToday: number;
  skippedReason?: string;
  stoppedBy?: string;
}

export async function publishQueue(app: AppContext, now: Date): Promise<PublishSummary> {
  const { config, logger } = app;
  const queue = new PostQueue(app.db);
  queue.expire(iso(now));
  const choice = createPublisher(config, logger);
  if (!choice.publisher) {
    logger.warn(choice.reason);
    return { mode: 'ninguno', published: 0, failed: 0, remainingToday: 0, skippedReason: choice.reason };
  }
  const publisher = choice.publisher;
  const tz = config.file.zonaHoraria;
  let remaining = config.file.publicacion.limiteDiario - queue.publishedOn(localToday(now, tz), tz);
  const quota = await publisher.remainingQuota?.();
  if (quota !== undefined) remaining = Math.min(remaining, quota);
  const summary: PublishSummary = { mode: publisher.mode, published: 0, failed: 0, remainingToday: Math.max(0, remaining) };

  for (const post of queue.dueForPublishing(iso(now), remaining)) {
    try {
      const files = mediaToPublish(post, config.file.publicacion.formato);
      const result = await publisher.publish({
        postId: post.id,
        kind: post.kind,
        caption: post.caption ?? '',
        altText: post.alt_text ?? undefined,
        images: files.map((path) => ({ path, url: publicUrlFor(config, path) })),
      });
      queue.markPublished(post.id, result);
      summary.published++;
      summary.remainingToday--;
      logger.info(`Publicada (${result.mode}): ${post.dedupe_key} → ${result.permalink ?? result.externalId}`);
    } catch (err) {
      summary.failed++;
      const pe = err instanceof PublishError ? err : undefined;
      const status = queue.markFailed(post.id, describeError(err), Boolean(pe?.retryable && !pe.uncertain), 'publish');
      logger.error(`No se pudo publicar ${post.dedupe_key}: ${describeError(err)} → ${status}`);
      if (pe?.fatal) {
        summary.stoppedBy = pe.code;
        break;
      }
    }
  }
  return summary;
}

/** Imágenes a publicar en el formato elegido, en orden de carrusel. */
function mediaToPublish(post: PostRow, format: string): string[] {
  const media = JSON.parse(post.media ?? '[]') as MediaFile[];
  const chosen = media.filter((m) => m.format === format);
  const files = (chosen.length ? chosen : media.filter((m) => m.format === media[0]?.format))
    .sort((a, b) => (a.slide ?? 1) - (b.slide ?? 1))
    .map((m) => m.jpg ?? m.png);
  const missing = files.filter((f) => !existsSync(f));
  if (files.length === 0 || missing.length) {
    throw new PublishError('MEDIA_MISSING', `Faltan imágenes de la publicación ${post.id}: ${missing.join(', ') || 'ninguna generada'}`, { retryable: false });
  }
  return files;
}

/** Borra carpetas de imágenes (por fecha) más antiguas que `days` días. */
export function cleanupMedia(mediaDir: string, days: number, now: Date): string[] {
  if (!existsSync(mediaDir)) return [];
  const limit = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const removed: string[] = [];
  for (const entry of readdirSync(mediaDir)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(entry) && entry < limit) {
      rmSync(join(mediaDir, entry), { recursive: true, force: true });
      removed.push(entry);
    }
  }
  return removed;
}
