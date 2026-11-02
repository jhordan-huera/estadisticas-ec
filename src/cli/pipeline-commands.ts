// Comandos del planificador y la publicación. Todos aceptan --ahora <ISO> para simular la hora.

import type { AppContext } from '../app.ts';
import { toLocal } from '../core/time.ts';
import { createNotifiers, notifyAll } from '../notify/notifier.ts';
import { diagnoseInstagram } from '../publish/diagnostic.ts';
import { publicUrlFor } from '../publish/factory.ts';
import { cleanupMedia, mediaToPublish, planPosts, publishQueue, renderQueue } from '../scheduler/pipeline.ts';
import { PostQueue, type PostStatus } from '../scheduler/queue.ts';
import { syncLineups } from '../sync/lineups.ts';
import { syncCompetitions } from '../sync/run.ts';
import { flagInt, flagString, type ParsedArgs } from './args.ts';

const out = (line = '') => process.stdout.write(line + '\n');

function nowFrom(args: ParsedArgs): Date {
  const v = flagString(args, 'ahora');
  if (!v) return new Date();
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`--ahora inválido: ${v}`);
  return d;
}

async function plan(app: AppContext, args: ParsedArgs) {
  const now = nowFrom(args);
  for (const r of planPosts(app, now)) {
    out(r.error ? `✗ ${r.competition}: ${r.error}` : `✓ ${r.competition}: ${r.candidates} candidatas, ${r.inserted} nuevas en cola, ${r.superseded} reemplazadas`);
  }
}

async function render(app: AppContext, args: ParsedArgs) {
  const s = await renderQueue(app, nowFrom(args));
  out(`Generadas: ${s.rendered} · con error: ${s.failed} · vencidas: ${s.expired}`);
  return s.failed === 0;
}

async function publish(app: AppContext, args: ParsedArgs) {
  const s = await publishQueue(app, nowFrom(args));
  if (s.skippedReason) out(`Publicación omitida: ${s.skippedReason}`);
  else out(`Modo ${s.mode}: publicadas ${s.published} · con error ${s.failed} · cupo restante hoy ${s.remainingToday}${s.stoppedBy ? ` · detenido por ${s.stoppedBy}` : ''}`);
  return s.failed === 0;
}

export const pipelineCommands = {
  planificar: async (app: AppContext, args: ParsedArgs) => {
    await plan(app, args);
    return 0;
  },

  generar: async (app: AppContext, args: ParsedArgs) => ((await render(app, args)) ? 0 : 1),

  publicar: async (app: AppContext, args: ParsedArgs) => ((await publish(app, args)) ? 0 : 1),

  /** Ciclo completo local: sincronizar → planificar → generar → publicar. */
  ciclo: async (app: AppContext, args: ParsedArgs) => {
    const synced = await syncCompetitions(app);
    for (const s of synced) out(s.ok ? `✓ sincronizado ${s.code}` : `✗ ${s.code}: ${s.error}`);
    await plan(app, args);
    const okRender = await render(app, args);
    const okPublish = await publish(app, args);
    return synced.every((s) => s.ok) && okRender && okPublish ? 0 : 1;
  },

  cola: (app: AppContext, args: ParsedArgs) => {
    const statuses: PostStatus[] = args.flags.todas ? ['pending', 'rendered', 'published', 'failed', 'skipped', 'expired'] : ['pending', 'rendered', 'failed'];
    const rows = new PostQueue(app.db).list(statuses, flagInt(args, 'limite') ?? 40);
    out(`Cola (${rows.length}):`);
    for (const r of rows) {
      const when = r.published_at ? `publicada ${toLocal(r.published_at, app.config.file.zonaHoraria).short}` : `desde ${toLocal(r.scheduled_for, app.config.file.zonaHoraria).short}`;
      out(`  #${String(r.id).padEnd(4)} ${r.status.padEnd(9)} p${String(r.priority).padEnd(3)} ${r.dedupe_key.padEnd(40)} ${when}${r.mode ? ` [${r.mode}]` : ''}${r.last_error ? ` · ${r.last_error.slice(0, 80)}` : ''}`);
    }
    return 0;
  },

  diagnostico: async (app: AppContext) => {
    out(`Modo: ${app.config.env.dryRun ? 'SIMULACIÓN (DRY_RUN activo)' : 'PUBLICACIÓN REAL'}`);
    out(`IMAGE_BASE_URL: ${app.config.env.imageBaseUrl ?? '(sin definir)'}`);
    const lines = await diagnoseInstagram(process.env, app.config.file.publicacion.instagram.version);
    for (const l of lines) out(`  ${l.ok ? '✓' : '✗'} ${l.label}: ${l.detail}`);
    return lines.every((l) => l.ok) ? 0 : 1;
  },

  /** Consulta y guarda alineaciones: las de los partidos próximos o las de un partido concreto. */
  alineaciones: async (app: AppContext, args: ParsedArgs) => {
    const code = flagString(args, 'competicion') ?? 'serie-a';
    const res = await syncLineups(app, code, { matchExternalId: flagString(args, 'partido'), now: nowFrom(args) });
    out(`Alineaciones ${code}: consultados ${res.checked} · guardados ${res.stored} · con error ${res.errors}`);
    return res.errors ? 1 : 0;
  },

  /** Envía un aviso de prueba por los canales configurados (ntfy / Telegram). */
  'avisos-prueba': async (app: AppContext) => {
    const notifiers = createNotifiers();
    if (notifiers.length === 0) {
      out('No hay canales de aviso configurados (NTFY_TOPIC, o TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).');
      return 1;
    }
    // Con las imágenes de la última publicación real, para ver el aviso tal como llegará.
    const last = new PostQueue(app.db).list(['published'], 50).find((p) => p.mode === 'instagram' && p.media);
    let images: { path: string; url?: string }[] = [];
    let url = `https://www.instagram.com/${app.config.file.marca.usuario.replace(/^@/, '')}/`;
    if (last) {
      try {
        images = mediaToPublish(last, app.config.file.publicacion.formato).map((path) => ({ path, url: publicUrlFor(app.config, path) }));
        url = last.permalink ?? url;
      } catch {
        images = [];
      }
    }
    const { sent, failed } = await notifyAll(
      notifiers,
      {
        title: 'Prueba de avisos',
        message: `Los avisos de ${app.config.file.marca.nombre} funcionan. Recibirás uno por cada publicación en Instagram${images.length ? ', con sus imágenes,' : ''} y si algo falla.`,
        url,
        images,
      },
      app.logger,
    );
    out(`Imágenes adjuntas: ${images.length}`);
    out(`Avisos enviados: ${sent.join(', ') || 'ninguno'}${failed.length ? ` · con error: ${failed.join(', ')}` : ''}`);
    return failed.length ? 1 : 0;
  },

  limpiar: (app: AppContext, args: ParsedArgs) => {
    const removed = cleanupMedia(app.config.env.mediaDir, flagInt(args, 'dias') ?? 30, nowFrom(args));
    out(removed.length ? `Carpetas eliminadas: ${removed.join(', ')}` : 'Nada que limpiar.');
    return 0;
  },
};
