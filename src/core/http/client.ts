// Cliente HTTP para JSON con:
//  - espaciado mínimo entre peticiones (límite de tasa por proveedor),
//  - caché con vencimiento,
//  - reintentos con espera exponencial (respeta Retry-After),
//  - rechazo explícito de respuestas que no son JSON (p. ej. páginas de Cloudflare).

import { HttpError } from '../errors.ts';
import { redact, type Logger } from '../logger.ts';
import { sha256 } from '../text.ts';
import type { HttpCache } from './cache.ts';

export interface HttpClientOptions {
  name: string;
  minIntervalMs: number;
  maxRetries: number;
  timeoutMs: number;
  cache: HttpCache;
  logger: Logger;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

export interface GetOptions {
  ttlSeconds: number;
  /** Si todos los intentos fallan y hay una copia vencida, usarla (queda registrado como advertencia). */
  allowStale?: boolean;
}

export interface JsonResult<T> {
  data: T;
  source: 'network' | 'cache' | 'stale-cache';
  fetchedAt: string;
}

const MAX_BACKOFF_MS = 30_000;

export class HttpClient {
  #opts: Required<Omit<HttpClientOptions, 'userAgent'>> & { userAgent: string };
  #nextSlot = 0;
  #queue: Promise<void> = Promise.resolve();
  requestCount = 0;

  constructor(options: HttpClientOptions) {
    this.#opts = {
      fetchImpl: globalThis.fetch,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      userAgent: 'EstadisticasEC/0.1 (+https://github.com/jhordan-huera/estadisticas-ec)',
      ...options,
    };
  }

  async getJson<T>(url: string, options: GetOptions): Promise<JsonResult<T>> {
    const key = sha256(url);
    const cached = this.#opts.cache.get(key);
    if (cached && !cached.expired) {
      return { data: JSON.parse(cached.body) as T, source: 'cache', fetchedAt: cached.fetchedAt };
    }

    try {
      const body = await this.#fetchWithRetries(url);
      this.#opts.cache.set(key, redact(url), body, options.ttlSeconds);
      return { data: JSON.parse(body) as T, source: 'network', fetchedAt: new Date().toISOString() };
    } catch (err) {
      if (options.allowStale && cached) {
        this.#opts.logger.warn('Usando copia vencida de la caché tras fallar la red', {
          url: redact(url),
          fetchedAt: cached.fetchedAt,
          error: String(err),
        });
        return { data: JSON.parse(cached.body) as T, source: 'stale-cache', fetchedAt: cached.fetchedAt };
      }
      throw err;
    }
  }

  async #fetchWithRetries(url: string): Promise<string> {
    const { maxRetries, logger, sleep } = this.#opts;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.#waitTurn();
      try {
        return await this.#fetchOnce(url);
      } catch (err) {
        lastError = err;
        const retryable = !(err instanceof HttpError) || err.retryable;
        if (!retryable || attempt === maxRetries) break;
        const retryAfter = err instanceof HttpError ? (err.context.retryAfterMs as number | undefined) : undefined;
        const backoff = Math.min(MAX_BACKOFF_MS, retryAfter ?? 1000 * 2 ** attempt + Math.floor(Math.random() * 250));
        logger.warn(`Reintento ${attempt + 1}/${maxRetries} en ${backoff} ms`, { url: redact(url), error: String(err) });
        await sleep(backoff);
      }
    }
    logger.error('Petición fallida tras agotar reintentos', { url: redact(url), error: String(lastError) });
    throw lastError;
  }

  async #fetchOnce(url: string): Promise<string> {
    this.requestCount++;
    let res: Response;
    try {
      res = await this.#opts.fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': this.#opts.userAgent },
        signal: AbortSignal.timeout(this.#opts.timeoutMs),
      });
    } catch (err) {
      throw new HttpError(0, redact(url), `Error de red: ${String(err)}`, true, { cause: err });
    }

    const text = await res.text();
    if (!res.ok) {
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      const error = new HttpError(res.status, redact(url), `HTTP ${res.status}: ${text.slice(0, 160)}`, retryable);
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      if (retryAfter !== undefined) error.context.retryAfterMs = retryAfter;
      throw error;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('json') && !looksLikeJson(text)) {
      throw new HttpError(res.status, redact(url), `Respuesta no JSON (${contentType || 'sin content-type'})`, true);
    }
    try {
      JSON.parse(text);
    } catch {
      throw new HttpError(res.status, redact(url), 'JSON inválido en la respuesta', true);
    }
    return text;
  }

  /** Serializa las peticiones de este cliente y respeta el intervalo mínimo entre ellas. */
  #waitTurn(): Promise<void> {
    const turn = this.#queue.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, this.#nextSlot - now);
      this.#nextSlot = Math.max(now, this.#nextSlot) + this.#opts.minIntervalMs;
      if (wait > 0) await this.#opts.sleep(wait);
    });
    this.#queue = turn.catch(() => {});
    return turn;
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function looksLikeJson(text: string): boolean {
  const c = text.trimStart()[0];
  return c === '{' || c === '[';
}
