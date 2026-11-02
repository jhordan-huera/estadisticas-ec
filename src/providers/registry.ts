// Punto único donde se construyen los proveedores. Para sumar una fuente nueva,
// se implementa DataProvider y se registra aquí con su propio perfil de red.

import type { AppConfig } from '../core/config.ts';
import type { HttpCache } from '../core/http/cache.ts';
import { HttpClient } from '../core/http/client.ts';
import type { Logger } from '../core/logger.ts';
import { EspnProvider } from './espn/provider.ts';
import { TheSportsDbProvider } from './thesportsdb/provider.ts';
import type { DataProvider } from './types.ts';

export interface ProviderRegistry {
  get(id: string): DataProvider;
  requestCounts(): Record<string, number>;
}

export function createProviders(config: AppConfig, cache: HttpCache, logger: Logger): ProviderRegistry {
  const red = config.file.red;
  const espnHttp = new HttpClient({
    name: 'espn',
    minIntervalMs: red.espn.intervaloMs,
    maxRetries: red.espn.reintentos,
    timeoutMs: red.espn.timeoutMs,
    cache,
    logger: logger.child('http:espn'),
  });
  const tsdbHttp = new HttpClient({
    name: 'thesportsdb',
    minIntervalMs: red.thesportsdb.intervaloMs,
    maxRetries: red.thesportsdb.reintentos,
    timeoutMs: red.thesportsdb.timeoutMs,
    cache,
    logger: logger.child('http:thesportsdb'),
  });

  const providers = new Map<string, DataProvider>([
    ['espn', new EspnProvider(espnHttp, red.cacheSegundos, logger.child('espn'))],
    ['thesportsdb', new TheSportsDbProvider(tsdbHttp, config.env.tsdbApiKey, red.cacheSegundos.copa, logger.child('thesportsdb'))],
  ]);

  return {
    get(id) {
      const p = providers.get(id);
      if (!p) throw new Error(`Proveedor no registrado: ${id}`);
      return p;
    },
    requestCounts: () => ({ espn: espnHttp.requestCount, thesportsdb: tsdbHttp.requestCount }),
  };
}
