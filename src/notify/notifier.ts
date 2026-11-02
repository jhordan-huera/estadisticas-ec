// Avisos al operador cuando se publica algo (o falla): ntfy y/o Telegram.
// Se activan solo con sus variables de entorno; un aviso que falla nunca detiene la publicación.

import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { redact, registerSecret, type Logger } from '../core/logger.ts';

export interface NoticeImage {
  /** Archivo local (para subirlo a Telegram). */
  path: string;
  /** URL pública (para adjuntarla en ntfy). */
  url?: string;
}

export interface Notice {
  title: string;
  message: string;
  /** Enlace que se abre al tocar el aviso (p. ej. la publicación en Instagram). */
  url?: string;
  priority?: 'default' | 'high';
  /** Imágenes de la publicación, en orden de carrusel. */
  images?: NoticeImage[];
}

export interface Notifier {
  readonly name: string;
  send(notice: Notice): Promise<void>;
}

/** ntfy (https://ntfy.sh o servidor propio): se publica en un tema al que te suscribes en la app. */
export class NtfyNotifier implements Notifier {
  readonly name = 'ntfy';
  #server: string;
  #topic: string;
  #token?: string;
  #fetch: typeof fetch;

  constructor(server: string, topic: string, token: string | undefined, fetchImpl: typeof fetch = fetch) {
    this.#server = server.replace(/\/+$/, '');
    this.#topic = topic;
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async send(n: Notice): Promise<void> {
    // Publicación en JSON: admite tildes y emojis en el título sin problemas de cabeceras.
    const res = await this.#fetch(this.#server, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.#token ? { authorization: `Bearer ${this.#token}` } : {}) },
      body: JSON.stringify({
        topic: this.#topic,
        title: n.title,
        message: n.message,
        priority: n.priority === 'high' ? 4 : 3,
        tags: [n.priority === 'high' ? 'warning' : 'soccer'],
        ...(n.url ? { click: n.url, actions: [{ action: 'view', label: 'Abrir', url: n.url }] } : {}),
        // ntfy muestra una imagen adjunta por URL: la primera de la publicación.
        ...(n.images?.[0]?.url ? { attach: n.images[0].url, filename: basename(n.images[0].path) } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ntfy respondió HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
}

/** Telegram limita el texto de una foto a 1024 caracteres y un álbum a 10 imágenes. */
const MAX_CAPTION = 1024;
const MAX_ALBUM = 10;

/** Telegram: un bot propio envía el aviso (con las imágenes de la publicación) a tu chat. */
export class TelegramNotifier implements Notifier {
  readonly name = 'telegram';
  #token: string;
  #chatId: string;
  #fetch: typeof fetch;

  constructor(token: string, chatId: string, fetchImpl: typeof fetch = fetch) {
    registerSecret(token);
    this.#token = token;
    this.#chatId = chatId;
    this.#fetch = fetchImpl;
  }

  async send(n: Notice): Promise<void> {
    const text = [`${n.priority === 'high' ? '⚠️' : '⚽'} ${n.title}`, n.message, n.url].filter(Boolean).join('\n\n');
    const photos = (n.images ?? []).filter((img) => existsSync(img.path)).slice(0, MAX_ALBUM);
    if (photos.length > 0) {
      try {
        await this.#sendPhotos(photos.map((p) => p.path), text.slice(0, MAX_CAPTION));
        return;
      } catch (err) {
        // Si las fotos fallan, el aviso igual llega en texto.
        this.#lastPhotoError = String(err);
      }
    }
    await this.#call('sendMessage', JSON.stringify({ chat_id: this.#chatId, text, disable_web_page_preview: false }), 'application/json');
    if (this.#lastPhotoError) {
      const reason = this.#lastPhotoError;
      this.#lastPhotoError = undefined;
      throw new Error(`Aviso enviado solo en texto; las imágenes fallaron: ${reason}`);
    }
  }

  #lastPhotoError?: string;

  /** Una foto con sendPhoto; varias como álbum con sendMediaGroup (el texto va en la primera). */
  async #sendPhotos(paths: string[], caption: string): Promise<void> {
    const form = new FormData();
    form.append('chat_id', this.#chatId);
    const blob = (path: string) => new Blob([readFileSync(path)], { type: 'image/jpeg' });
    if (paths.length === 1) {
      form.append('caption', caption);
      form.append('photo', blob(paths[0]!), basename(paths[0]!));
      await this.#call('sendPhoto', form);
      return;
    }
    const media = paths.map((_, i) => ({ type: 'photo', media: `attach://foto${i}`, ...(i === 0 ? { caption } : {}) }));
    form.append('media', JSON.stringify(media));
    paths.forEach((path, i) => form.append(`foto${i}`, blob(path), basename(path)));
    await this.#call('sendMediaGroup', form);
  }

  async #call(method: string, body: string | FormData, contentType?: string): Promise<void> {
    const res = await this.#fetch(`https://api.telegram.org/bot${this.#token}/${method}`, {
      method: 'POST',
      headers: contentType ? { 'content-type': contentType } : undefined,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Telegram (${method}) respondió HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
}

/** Canales configurados en el entorno (secretos de GitHub). Sin variables, no hay avisos. */
export function createNotifiers(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Notifier[] {
  const out: Notifier[] = [];
  const topic = env.NTFY_TOPIC?.trim();
  if (topic) {
    registerSecret(topic);
    registerSecret(env.NTFY_TOKEN?.trim());
    out.push(new NtfyNotifier(env.NTFY_SERVER?.trim() || 'https://ntfy.sh', topic, env.NTFY_TOKEN?.trim() || undefined, fetchImpl));
  }
  const tgToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const tgChat = env.TELEGRAM_CHAT_ID?.trim();
  if (tgToken && tgChat) out.push(new TelegramNotifier(tgToken, tgChat, fetchImpl));
  return out;
}

/** Envía a todos los canales; los fallos se registran pero no se propagan. */
export async function notifyAll(notifiers: Notifier[], notice: Notice, logger: Logger): Promise<{ sent: string[]; failed: string[] }> {
  const results = await Promise.allSettled(notifiers.map((n) => n.send(notice)));
  const sent: string[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    const name = notifiers[i]!.name;
    if (r.status === 'fulfilled') sent.push(name);
    else {
      failed.push(name);
      logger.warn(`No se pudo enviar el aviso por ${name}`, { error: redact(String(r.reason)) });
    }
  });
  return { sent, failed };
}

export const KIND_LABEL: Record<string, string> = {
  cartelera: 'Cartelera',
  resultado: 'Resultado',
  resumen: 'Resumen de la fecha',
  tabla: 'Tabla de posiciones',
  goleadores: 'Goleadores',
  equipo: 'Radiografía de equipo',
  duelo: 'Previa',
  alineaciones: 'Alineaciones confirmadas',
};
