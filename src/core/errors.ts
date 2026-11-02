// Errores con código estable para poder registrarlos y filtrarlos.

export class AppError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(code: string, message: string, context: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.context = context;
  }
}

export class HttpError extends AppError {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number, url: string, message: string, retryable: boolean, options?: ErrorOptions) {
    super('HTTP_ERROR', message, { status, url }, options);
    this.name = 'HttpError';
    this.status = status;
    this.retryable = retryable;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('CONFIG_ERROR', message, context);
    this.name = 'ConfigError';
  }
}

export function describeError(err: unknown): string {
  if (err instanceof AppError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
