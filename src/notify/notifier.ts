// Avisos al operador cuando se publica algo (o falla): ntfy y/o Telegram.
// Se activan solo con sus variables de entorno; un aviso que falla nunca detiene la publicación.

import { redact, registerSecret, type Logger } from '../core/logger.ts';

export interface Notice {
  title: string;
  message: string;
  /** Enlace que se abre al tocar el aviso (p. ej. la publicación en Instagram). */
  url?: string;
  priority?: 'default' | 'high';
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
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`ntfy respondió HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
}

/** Telegram: un bot propio envía el mensaje a tu chat. */
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
    const res = await this.#fetch(`https://api.telegram.org/bot${this.#token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: this.#chatId, text, disable_web_page_preview: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Telegram respondió HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
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
};
