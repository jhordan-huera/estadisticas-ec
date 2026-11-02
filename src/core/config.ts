// Configuración: archivo JSON versionado (sin secretos) + variables de entorno.
// Los secretos solo se leen del entorno y se registran en el logger para ocultarlos.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError } from './errors.ts';
import { registerSecret, type LogLevel } from './logger.ts';

export type Tiebreaker = 'puntos' | 'diferencia' | 'golesFavor' | 'enfrentamientos' | 'golesVisitante' | 'victorias' | 'alfabetico';

export interface TableRules {
  puntosVictoria: number;
  puntosEmpate: number;
  /** "acumulados": las tablas de grupo suman toda la temporada; "reiniciados": solo la fase final. */
  puntosFaseFinal: 'acumulados' | 'reiniciados';
  desempate: Tiebreaker[];
}

export const DEFAULT_TABLE_RULES: TableRules = {
  puntosVictoria: 3,
  puntosEmpate: 1,
  puntosFaseFinal: 'acumulados',
  desempate: ['puntos', 'diferencia', 'golesFavor', 'enfrentamientos', 'golesVisitante', 'alfabetico'],
};

export interface EspnCompetitionConfig {
  nombre: string;
  tipo: 'liga';
  proveedor: 'espn';
  liga: string;
  nombresFase?: Record<string, string>;
  nombresGrupo?: Record<string, string>;
  tabla?: Partial<TableRules>;
}

export interface TsdbCompetitionConfig {
  nombre: string;
  tipo: 'copa';
  proveedor: 'thesportsdb';
  liga: string;
  rondas: number[];
  etiquetasRonda?: Record<string, string>;
}

export type CompetitionConfig = EspnCompetitionConfig | TsdbCompetitionConfig;

export interface NetworkProfile {
  intervaloMs: number;
  reintentos: number;
  timeoutMs: number;
}

export interface FileConfig {
  marca: { nombre: string; usuario: string; pie: string; usarLogos?: boolean };
  temporada: number;
  zonaHoraria: string;
  competiciones: Record<string, CompetitionConfig>;
  textos?: CopyConfig;
  publicacion: PublishingConfig;
  red: {
    espn: NetworkProfile;
    thesportsdb: NetworkProfile;
    cacheSegundos: { temporada: number; fases: number; posiciones: number; copa: number };
  };
}

export type PostKind = 'cartelera' | 'resultado' | 'resumen' | 'tabla' | 'goleadores' | 'equipo' | 'duelo';

export interface PublishingConfig {
  /** Máximo de publicaciones por día (fecha de Ecuador). */
  limiteDiario: number;
  /** Formato que se publica: "vertical" (1080x1350) o "cuadrado" (1080x1080). */
  formato: 'vertical' | 'cuadrado';
  formatosRender: ('vertical' | 'cuadrado')[];
  /** Ancho del JPEG que se publica (Instagram guarda hasta 1440 px): más nitidez al acercar. */
  anchoInstagram?: number;
  /** Solo se planifica contenido de los últimos N días (evita publicar la temporada entera al empezar). */
  ventanaDias: number;
  /** Fecha de arranque (ISO con zona): nada sobre partidos anteriores se publica. */
  desde?: string;
  anticipacionCarteleraHoras: number;
  anticipacionPreviaHoras: number;
  /** Tipos de publicación habilitados por competición. */
  competiciones: Record<string, PostKind[]>;
  instagram: { version: string; enviarTextoAlternativo: boolean };
}

export interface CopyConfig {
  hashtags: {
    base: string[];
    porTipo?: Record<string, string[]>;
    /** Añadir un hashtag por cada equipo mencionado (derivado del nombre o de "hashtag" en equipos.json). */
    equipos: boolean;
    maximo: number;
  };
  /** Línea de atribución de la fuente de datos. */
  fuente?: string;
}

export interface TeamOverride {
  nombre?: string;
  corto?: string;
  abrev?: string;
  alias?: string[];
  /** Color principal de la marca del equipo (#rrggbb). */
  color?: string;
  /** Color del texto sobre esa marca; si falta se calcula por contraste. */
  texto?: string;
  /** Hashtag propio del equipo (si no, se deriva del nombre). */
  hashtag?: string;
  verificar?: boolean;
}

export interface EnvConfig {
  dbPath: string;
  cacheDbPath: string;
  outDir: string;
  /** Carpeta de las imágenes generadas para la cola. */
  mediaDir: string;
  /** Raíz del estado versionado (rama "estado"); las URL públicas se calculan relativas a ella. */
  stateDir: string;
  /** Base pública de las imágenes, p. ej. https://raw.githubusercontent.com/usuario/repo/estado */
  imageBaseUrl?: string;
  logLevel: LogLevel;
  dryRun: boolean;
  tsdbApiKey: string;
}

export interface AppConfig {
  file: FileConfig;
  teams: Record<string, TeamOverride>;
  env: EnvConfig;
  rootDir: string;
}

export function loadConfig(rootDir = process.cwd(), env: NodeJS.ProcessEnv = process.env): AppConfig {
  const file = readJson<FileConfig>(resolve(rootDir, env.MARCADOR_CONFIG ?? 'config/marcador.config.json'));
  validateFileConfig(file);
  // Permite probar con logos sin cambiar la configuración versionada.
  if (env.MARCADOR_USAR_LOGOS !== undefined) file.marca.usarLogos = env.MARCADOR_USAR_LOGOS.trim().toLowerCase() === 'true';
  const teamsRaw = readJson<Record<string, TeamOverride | string>>(resolve(rootDir, 'config/equipos.json'));
  const teams: Record<string, TeamOverride> = {};
  for (const [key, value] of Object.entries(teamsRaw)) {
    if (key.startsWith('_') || typeof value !== 'object') continue;
    teams[key] = value;
  }

  const tsdbApiKey = env.TSDB_API_KEY?.trim() || '123';
  // La clave gratuita pública ("123") no es secreta; una clave de pago sí.
  if (tsdbApiKey !== '123') registerSecret(tsdbApiKey);
  for (const name of ['IG_ACCESS_TOKEN', 'FACEBOOK_ACCESS_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) registerSecret(env[name]);

  return {
    file,
    teams,
    rootDir,
    env: {
      dbPath: resolve(rootDir, env.MARCADOR_DB ?? 'data/marcador.sqlite'),
      cacheDbPath: resolve(rootDir, env.MARCADOR_CACHE_DB ?? 'data/cache-http.sqlite'),
      outDir: resolve(rootDir, env.MARCADOR_OUT ?? 'out'),
      mediaDir: resolve(rootDir, env.MARCADOR_MEDIA ?? 'out/posts'),
      stateDir: resolve(rootDir, env.MARCADOR_STATE_DIR ?? '.'),
      imageBaseUrl: env.IMAGE_BASE_URL?.trim() || undefined,
      logLevel: parseLogLevel(env.LOG_LEVEL),
      // Simulación activada por defecto: solo DRY_RUN=false desactiva la simulación.
      dryRun: (env.DRY_RUN ?? 'true').trim().toLowerCase() !== 'false',
      tsdbApiKey,
    },
  };
}

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    throw new ConfigError(`No se pudo leer la configuración ${path}`, { cause: String(err) });
  }
}

function parseLogLevel(value: string | undefined): LogLevel {
  const v = (value ?? 'info').toLowerCase();
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
  throw new ConfigError(`LOG_LEVEL inválido: ${value}`);
}

function validateFileConfig(cfg: FileConfig): void {
  if (!Number.isInteger(cfg.temporada)) throw new ConfigError('"temporada" debe ser un año entero');
  if (!cfg.competiciones || Object.keys(cfg.competiciones).length === 0) {
    throw new ConfigError('"competiciones" no puede estar vacío');
  }
  for (const [code, comp] of Object.entries(cfg.competiciones)) {
    if (comp.proveedor === 'espn') continue;
    if (comp.proveedor === 'thesportsdb') {
      if (!Array.isArray(comp.rondas) || comp.rondas.length === 0) {
        throw new ConfigError(`La competición ${code} necesita "rondas"`);
      }
      continue;
    }
    throw new ConfigError(`Proveedor desconocido en ${code}: ${(comp as { proveedor: string }).proveedor}`);
  }
}
