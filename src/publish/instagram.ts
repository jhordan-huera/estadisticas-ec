// Publicación con la API oficial de Instagram (Graph API), en dos pasos:
//   1) crear un contenedor con la URL pública de la imagen y el texto,
//   2) esperar a que esté listo y publicarlo.
// Admite los dos flujos oficiales de Meta y detecta el host por el tipo de token:
//   "IGAA…" (inicio de sesión con Instagram) → graph.instagram.com
//   "EAA…"  (inicio de sesión con Facebook)  → graph.facebook.com
// El token solo viaja en las peticiones; nunca se imprime ni se guarda.

import { redact, registerSecret, type Logger } from '../core/logger.ts';
import { PublishError, type Publisher, type PublishRequest, type PublishResult } from './types.ts';

export type TokenKind = 'instagram-login' | 'facebook-login';

export function detectTokenKind(token: string): TokenKind | undefined {
  if (token.startsWith('IGAA') || token.startsWith('IG')) return 'instagram-login';
  if (token.startsWith('EAA')) return 'facebook-login';
  return undefined;
}

export function graphHost(kind: TokenKind): string {
  return kind === 'instagram-login' ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
}

export interface InstagramOptions {
  userId: string;
  accessToken: string;
  version: string;
  sendAltText: boolean;
  logger: Logger;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}

interface GraphError {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

// Códigos de la Graph API: 4/17/32/613 = límite de tasa; 1/2 = error temporal; 190 = token inválido.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const TRANSIENT_CODES = new Set([1, 2]);
/** Máximo de imágenes de un carrusel en la API de Instagram. */
const MAX_CAROUSEL = 10;

export class InstagramGraphPublisher implements Publisher {
  readonly mode = 'instagram' as const;
  #o: Required<Omit<InstagramOptions, 'fetchImpl' | 'sleep'>> & { fetchImpl: typeof fetch; sleep: (ms: number) => Promise<void> };
  #base: string;

  constructor(options: InstagramOptions) {
    // Defensa en profundidad: aunque la configuración ya lo registró, el token nunca debe
    // poder aparecer en un mensaje (la API a veces lo repite en sus errores).
    registerSecret(options.accessToken);
    const kind = detectTokenKind(options.accessToken);
    if (!kind) throw new PublishError('IG_TOKEN_UNKNOWN', 'Tipo de token no reconocido (se espera IGAA… o EAA…)', { fatal: true });
    this.#o = {
      fetchImpl: globalThis.fetch,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      pollIntervalMs: 3000,
      maxPolls: 20,
      ...options,
    };
    this.#base = `${graphHost(kind)}/${options.version}`;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    if (req.images.length === 0 || req.images.length > MAX_CAROUSEL) {
      throw new PublishError('IG_BAD_IMAGE_COUNT', `Una publicación lleva entre 1 y ${MAX_CAROUSEL} imágenes (hay ${req.images.length})`);
    }
    const urls = req.images.map((img) => img.url);
    if (urls.some((u) => !u)) throw new PublishError('IG_NO_IMAGE_URL', 'Falta la URL pública de alguna imagen (configura IMAGE_BASE_URL)', { fatal: true });
    for (const url of urls) await this.#checkImageReachable(url!);

    const container = urls.length === 1 ? await this.#singleContainer(urls[0]!, req) : await this.#carouselContainer(urls as string[], req);
    await this.#waitUntilReady(container);

    // media_publish no es idempotente: si la red falla aquí no sabemos si salió publicado.
    let published: { id: string };
    try {
      published = await this.#call<{ id: string }>('POST', `/${this.#o.userId}/media_publish`, { creation_id: container });
    } catch (err) {
      if (err instanceof PublishError && err.code === 'IG_NETWORK') {
        throw new PublishError('IG_PUBLISH_UNCERTAIN', 'Se perdió la conexión al publicar; revisa la cuenta antes de reintentar', { uncertain: true });
      }
      throw err;
    }
    let permalink: string | undefined;
    try {
      permalink = (await this.#call<{ permalink?: string }>('GET', `/${published.id}`, { fields: 'permalink' })).permalink;
    } catch (err) {
      this.#o.logger.warn('Publicado, pero no se pudo obtener el enlace', { mediaId: published.id, error: String(err) });
    }
    return { mode: this.mode, externalId: published.id, permalink };
  }

  async #singleContainer(url: string, req: PublishRequest): Promise<string> {
    const params: Record<string, string> = { image_url: url, caption: req.caption };
    if (this.#o.sendAltText && req.altText) params.alt_text = req.altText;
    return (await this.#call<{ id: string }>('POST', `/${this.#o.userId}/media`, params)).id;
  }

  /** Carrusel: un contenedor por imagen (sin texto) y uno padre con los hijos y el texto. */
  async #carouselContainer(urls: string[], req: PublishRequest): Promise<string> {
    const children: string[] = [];
    for (const url of urls) {
      const item = await this.#call<{ id: string }>('POST', `/${this.#o.userId}/media`, { image_url: url, is_carousel_item: 'true' });
      await this.#waitUntilReady(item.id);
      children.push(item.id);
    }
    const parent = await this.#call<{ id: string }>('POST', `/${this.#o.userId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: req.caption });
    return parent.id;
  }

  async remainingQuota(): Promise<number | undefined> {
    try {
      const res = await this.#call<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>('GET', `/${this.#o.userId}/content_publishing_limit`, {
        fields: 'quota_usage,config',
      });
      const entry = res.data?.[0];
      if (entry?.quota_usage === undefined || entry.config?.quota_total === undefined) return undefined;
      return entry.config.quota_total - entry.quota_usage;
    } catch (err) {
      this.#o.logger.warn('No se pudo consultar el cupo de publicación de Instagram', { error: String(err) });
      return undefined;
    }
  }

  async #waitUntilReady(containerId: string): Promise<void> {
    for (let i = 0; i < this.#o.maxPolls; i++) {
      const res = await this.#call<{ status_code?: string; status?: string }>('GET', `/${containerId}`, { fields: 'status_code,status' });
      if (res.status_code === 'FINISHED') return;
      if (res.status_code === 'ERROR' || res.status_code === 'EXPIRED') {
        throw new PublishError('IG_CONTAINER_FAILED', `Instagram rechazó la imagen: ${res.status ?? res.status_code}`, { retryable: false });
      }
      await this.#o.sleep(this.#o.pollIntervalMs);
    }
    throw new PublishError('IG_CONTAINER_TIMEOUT', 'El contenedor no quedó listo a tiempo', { retryable: true });
  }

  /** Comprueba que Instagram podrá descargar la imagen (repo público, archivo ya subido). */
  async #checkImageReachable(url: string): Promise<void> {
    let res: Response;
    try {
      res = await this.#o.fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new PublishError('IMAGE_URL_UNREACHABLE', `No se pudo acceder a la imagen ${url}: ${String(err)}`, { retryable: true });
    }
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) {
      throw new PublishError('IMAGE_URL_UNREACHABLE', `La imagen ${url} respondió HTTP ${res.status} (${type || 'sin tipo'}); ¿el repositorio es público y el archivo ya está subido?`, {
        retryable: true,
      });
    }
  }

  async #call<T>(method: 'GET' | 'POST', path: string, params: Record<string, string>): Promise<T> {
    const body = new URLSearchParams({ ...params, access_token: this.#o.accessToken });
    const url = method === 'GET' ? `${this.#base}${path}?${body}` : `${this.#base}${path}`;
    let res: Response;
    try {
      res = await this.#o.fetchImpl(url, {
        method,
        body: method === 'POST' ? body : undefined,
        headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new PublishError('IG_NETWORK', `Error de red con la API de Instagram: ${redact(String(err))}`, { retryable: true });
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new PublishError('IG_BAD_RESPONSE', `Respuesta no JSON de Instagram (HTTP ${res.status})`, { retryable: res.status >= 500 });
    }
    const err = (json as GraphError).error;
    if (!res.ok || err) {
      const code = err?.code ?? res.status;
      const message = redact(err?.message ?? `HTTP ${res.status}`);
      if (code === 190) throw new PublishError('IG_TOKEN_INVALID', `Token inválido o vencido: ${message}`, { fatal: true, context: { code } });
      if (RATE_LIMIT_CODES.has(code)) throw new PublishError('IG_RATE_LIMIT', `Límite de la API alcanzado: ${message}`, { retryable: true, fatal: true, context: { code } });
      throw new PublishError('IG_API_ERROR', `Instagram respondió ${code}: ${message}`, {
        retryable: TRANSIENT_CODES.has(code) || res.status >= 500,
        context: { code, subcode: err?.error_subcode, trace: err?.fbtrace_id },
      });
    }
    return json as T;
  }
}
