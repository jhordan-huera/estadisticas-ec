// Proveedor TheSportsDB para Copa Ecuador y Supercopa (módulo aparte de la liga).
// Su límite de tasa es estricto (HTTP 429 servido como HTML por Cloudflare tras ~13
// peticiones/minuto), por eso el cliente HTTP de este proveedor espacia ~3,5 s cada llamada.

import type { TsdbCompetitionConfig } from '../../core/config.ts';
import type { HttpClient } from '../../core/http/client.ts';
import type { Logger } from '../../core/logger.ts';
import type { DataProvider, ProviderIssue, SeasonRequest, SeasonSnapshot } from '../types.ts';
import { mapTsdbEvents, STAGE_ID } from './mapper.ts';
import type { TsdbEvent, TsdbEventsResponse } from './raw.ts';

/** El plan gratuito devuelve como máximo 15 partidos por consulta. */
export const FREE_TIER_CAP = 15;

export class TheSportsDbProvider implements DataProvider {
  readonly id = 'thesportsdb';
  #http: HttpClient;
  #apiKey: string;
  #ttlSeconds: number;
  #logger: Logger;

  constructor(http: HttpClient, apiKey: string, ttlSeconds: number, logger: Logger) {
    this.#http = http;
    this.#apiKey = apiKey;
    this.#ttlSeconds = ttlSeconds;
    this.#logger = logger;
  }

  async fetchSeason(request: SeasonRequest): Promise<SeasonSnapshot> {
    const comp = request.competition as TsdbCompetitionConfig;
    const base = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(this.#apiKey)}`;
    const league = encodeURIComponent(comp.liga);
    const issues: ProviderIssue[] = [];
    const byId = new Map<string, TsdbEvent>();
    const freeTier = this.#apiKey === '123';

    const collect = async (label: string, url: string, capCheck: boolean) => {
      const res = await this.#http.getJson<TsdbEventsResponse>(url, { ttlSeconds: this.#ttlSeconds, allowStale: true });
      if (res.source === 'stale-cache') {
        issues.push({ severity: 'warning', code: 'STALE_DATA', entityRef: `thesportsdb:${comp.liga}:${label}`, message: `Se usaron datos vencidos de la caché para ${label}` });
      }
      const events = (res.data.events ?? res.data.results ?? []).filter((e) => !e.strSeason || e.strSeason === String(request.season));
      if (capCheck && freeTier && events.length >= FREE_TIER_CAP) {
        issues.push({
          severity: 'warning',
          code: 'TSDB_FREE_TIER_TRUNCATED',
          entityRef: `thesportsdb:${comp.liga}:${request.season}:${label}`,
          message: `${label}: la API gratuita devolvió ${events.length} partidos (su tope); pueden faltar partidos de esta ronda`,
        });
      }
      for (const e of events) byId.set(e.idEvent, e);
    };

    for (const round of comp.rondas) {
      await collect(`ronda ${round}`, `${base}/eventsround.php?id=${league}&r=${round}&s=${request.season}`, true);
    }
    // El último y el próximo partido de la competición, por si una ronda no está configurada.
    await collect('último partido', `${base}/eventspastleague.php?id=${league}`, false);
    await collect('próximo partido', `${base}/eventsnextleague.php?id=${league}`, false);

    const mapped = mapTsdbEvents({
      competitionCode: request.competitionCode,
      events: [...byId.values()],
      rounds: comp.rondas,
      roundLabels: comp.etiquetasRonda,
    });
    const kickoffs = mapped.matches.map((m) => m.kickoffUtc).sort();
    this.#logger.info(`TheSportsDB ${comp.nombre} ${request.season}: ${mapped.matches.length} partidos`);

    return {
      provider: this.id,
      competitionCode: request.competitionCode,
      season: request.season,
      hasEventDetail: false,
      teams: mapped.teams,
      stages: [{ externalId: STAGE_ID, name: 'Eliminación directa', kind: 'knockout', order: 1, startsAt: kickoffs[0], endsAt: kickoffs.at(-1) }],
      groups: [],
      matches: mapped.matches,
      referenceStandings: [],
      issues: [...issues, ...mapped.issues],
    };
  }
}
