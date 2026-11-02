// Elige el publicador según la configuración. DRY_RUN está activo salvo DRY_RUN=false.
// Las credenciales se leen solo del entorno (secretos de GitHub) y nunca se imprimen.

import { relative, sep } from 'node:path';
import type { AppConfig } from '../core/config.ts';
import type { Logger } from '../core/logger.ts';
import { DryRunPublisher } from './dry-run.ts';
import { InstagramGraphPublisher } from './instagram.ts';
import type { Publisher } from './types.ts';

export type PublisherChoice = { publisher: Publisher } | { publisher: null; reason: string };

export function createPublisher(config: AppConfig, logger: Logger, env: NodeJS.ProcessEnv = process.env): PublisherChoice {
  if (config.env.dryRun) return { publisher: new DryRunPublisher(config.env.outDir, config.file.zonaHoraria) };
  const userId = env.IG_USER_ID?.trim();
  const token = env.IG_ACCESS_TOKEN?.trim();
  const missing = [!userId && 'IG_USER_ID', !token && 'IG_ACCESS_TOKEN', !config.env.imageBaseUrl && 'IMAGE_BASE_URL'].filter(Boolean);
  if (missing.length) {
    return { publisher: null, reason: `Faltan ${missing.join(', ')}; las publicaciones quedan en cola hasta configurarlos` };
  }
  return {
    publisher: new InstagramGraphPublisher({
      userId: userId!,
      accessToken: token!,
      version: config.file.publicacion.instagram.version,
      sendAltText: config.file.publicacion.instagram.enviarTextoAlternativo,
      logger: logger.child('instagram'),
    }),
  };
}

/** URL pública de un archivo del estado: IMAGE_BASE_URL + ruta relativa a la raíz del estado. */
export function publicUrlFor(config: AppConfig, filePath: string): string | undefined {
  const base = config.env.imageBaseUrl;
  if (!base) return undefined;
  const rel = relative(config.env.stateDir, filePath).split(sep).map(encodeURIComponent).join('/');
  if (rel.startsWith('..')) throw new Error(`La imagen ${filePath} está fuera de la carpeta de estado (${config.env.stateDir})`);
  return `${base.replace(/\/+$/, '')}/${rel}`;
}
