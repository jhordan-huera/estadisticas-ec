// Logger mínimo con niveles. Todo lo que se imprime pasa por `redact`,
// de modo que ningún token registrado aparezca en consola ni en archivos.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_LABEL: Record<LogLevel, string> = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

const secrets = new Set<string>();
const SECRET_QUERY_PARAMS = /([?&](?:access_token|client_secret|fb_exchange_token|input_token|api_key|key)=)[^&\s"]+/gi;

/** Registra un valor sensible para que nunca se imprima. Ignora valores cortos o vacíos. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 6) secrets.add(value);
}

export function redact(text: string): string {
  let out = text.replace(SECRET_QUERY_PARAMS, '$1***');
  for (const secret of secrets) out = out.split(secret).join('***');
  return out;
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  scope?: string;
  write?: (line: string) => void;
}

export function createLogger(options: LoggerOptions): Logger {
  const minLevel = LEVEL_ORDER[options.level];
  const write = options.write ?? ((line: string) => process.stderr.write(line + '\n'));

  const emit = (level: LogLevel, msg: string, ctx?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < minLevel) return;
    const scope = options.scope ? ` [${options.scope}]` : '';
    const extra = ctx && Object.keys(ctx).length > 0 ? ' ' + safeJson(ctx) : '';
    write(redact(`${new Date().toISOString()} ${LEVEL_LABEL[level]}${scope} ${msg}${extra}`));
  };

  return {
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info: (msg, ctx) => emit('info', msg, ctx),
    warn: (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, ctx) => emit('error', msg, ctx),
    child: (scope) =>
      createLogger({ ...options, scope: options.scope ? `${options.scope}:${scope}` : scope }),
  };
}

/** Logger silencioso para pruebas. */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => nullLogger,
};

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (v instanceof Error ? { name: v.name, message: v.message } : v));
  } catch {
    return '[contexto no serializable]';
  }
}
