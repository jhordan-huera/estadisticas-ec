// Interfaz común de publicación. El resto del sistema no sabe si publica en Instagram
// o si simula: solo entrega la imagen, el texto y recibe un identificador.

import { AppError } from '../core/errors.ts';

export interface PublishRequest {
  postId: number;
  kind: string;
  caption: string;
  altText?: string;
  /**
   * Imágenes en orden: una sola es una publicación simple; varias (hasta 10) forman un carrusel.
   * `url` es la dirección pública desde la que la API de Instagram descarga cada imagen.
   */
  images: { path: string; url?: string }[];
}

export interface PublishResult {
  mode: 'dry-run' | 'instagram';
  externalId: string;
  permalink?: string;
}

export interface Publisher {
  readonly mode: PublishResult['mode'];
  publish(request: PublishRequest): Promise<PublishResult>;
  /** Cupo restante de la plataforma en las últimas 24 h, si se puede consultar. */
  remainingQuota?(): Promise<number | undefined>;
}

/**
 * Error de publicación. `retryable` indica si conviene reintentar más tarde;
 * `fatal` detiene la tanda (p. ej. token inválido); `uncertain` indica que no se
 * sabe si la publicación llegó a salir (no se reintenta automáticamente).
 */
export class PublishError extends AppError {
  readonly retryable: boolean;
  readonly fatal: boolean;
  readonly uncertain: boolean;

  constructor(code: string, message: string, opts: { retryable?: boolean; fatal?: boolean; uncertain?: boolean; context?: Record<string, unknown> } = {}) {
    super(code, message, opts.context ?? {});
    this.name = 'PublishError';
    this.retryable = opts.retryable ?? false;
    this.fatal = opts.fatal ?? false;
    this.uncertain = opts.uncertain ?? false;
  }
}
