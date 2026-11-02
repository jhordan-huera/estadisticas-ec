// Composición de dependencias compartida por la CLI y las pruebas de integración.

import { loadConfig, type AppConfig } from './core/config.ts';
import { SqliteHttpCache } from './core/http/cache.ts';
import { createLogger, type Logger } from './core/logger.ts';
import { openDatabase, type Db } from './db/connection.ts';
import { migrate } from './db/migrate.ts';
import { createProviders, type ProviderRegistry } from './providers/registry.ts';

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  db: Db;
  providers: () => ProviderRegistry;
  close(): void;
}

export function createApp(rootDir = process.cwd()): AppContext {
  const config = loadConfig(rootDir);
  const logger = createLogger({ level: config.env.logLevel });
  const db = openDatabase(config.env.dbPath);
  migrate(db, logger.child('db'));

  let cache: SqliteHttpCache | undefined;
  let registry: ProviderRegistry | undefined;
  return {
    config,
    logger,
    db,
    // La caché HTTP y los proveedores solo se crean si un comando los necesita.
    providers: () => {
      if (!registry) {
        cache = new SqliteHttpCache(config.env.cacheDbPath);
        const purged = cache.purge(7);
        if (purged > 0) logger.debug(`Caché HTTP: ${purged} entradas antiguas eliminadas`);
        registry = createProviders(config, cache, logger);
      }
      return registry;
    },
    close: () => {
      cache?.close();
      db.close();
    },
  };
}
