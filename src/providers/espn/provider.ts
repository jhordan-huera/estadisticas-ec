// Proveedor ESPN (endpoints públicos sin clave).
// Una sincronización completa son 4 peticiones: fases (2), tabla (1) y scoreboard anual (1).

import type { EspnCompetitionConfig } from '../../core/config.ts';
import { AppError } from '../../core/errors.ts';
import type { HttpClient } from '../../core/http/client.ts';
import type { Logger } from '../../core/logger.ts';
import type { DataProvider, ProviderIssue, SeasonRequest, SeasonSnapshot } from '../types.ts';
import { mapEspnSeason } from './mapper.ts';
import type { EspnRefList, EspnScoreboard, EspnSeasonType, EspnStandings } from './raw.ts';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer';
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues';
/** El scoreboard sin `limit` corta en 100 partidos; con 1000 cabe una temporada completa. */
const SCOREBOARD_LIMIT = 1000;

export interface EspnTtl {
  temporada: number;
  fases: number;
  posiciones: number;
}

export class EspnProvider implements DataProvider {
  readonly id = 'espn';
  #http: HttpClient;
  #ttl: EspnTtl;
  #logger: Logger;

  constructor(http: HttpClient, ttl: EspnTtl, logger: Logger) {
    this.#http = http;
    this.#ttl = ttl;
    this.#logger = logger;
  }

  async fetchSeason(request: SeasonRequest): Promise<SeasonSnapshot> {
    const comp = request.competition as EspnCompetitionConfig;
    const league = encodeURIComponent(comp.liga);
    const { season } = request;
    const issues: ProviderIssue[] = [];
    const stale = (what: string, source: string) => {
      if (source === 'stale-cache') {
        issues.push({ severity: 'warning', code: 'STALE_DATA', entityRef: `espn:${league}:${what}`, message: `Se usaron datos vencidos de la caché para ${what}` });
      }
    };

    const typeList = await this.#http.getJson<EspnRefList>(`${CORE}/${league}/seasons/${season}/types?lang=es`, { ttlSeconds: this.#ttl.fases, allowStale: true });
    stale('fases', typeList.source);
    const seasonTypes: EspnSeasonType[] = [];
    for (const item of typeList.data.items ?? []) {
      const res = await this.#http.getJson<EspnSeasonType>(item.$ref.replace(/^http:/, 'https:'), { ttlSeconds: this.#ttl.fases, allowStale: true });
      stale(`fase ${res.data.id}`, res.source);
      seasonTypes.push(res.data);
    }
    if (seasonTypes.length === 0) {
      throw new AppError('ESPN_NO_STAGES', `ESPN no devolvió fases para ${comp.liga} ${season}`);
    }

    const standings = await this.#http.getJson<EspnStandings>(`${STANDINGS}/${league}/standings?season=${season}`, { ttlSeconds: this.#ttl.posiciones, allowStale: true });
    stale('tabla', standings.source);

    const scoreboard = await this.#http.getJson<EspnScoreboard>(`${SITE}/${league}/scoreboard?dates=${season}&limit=${SCOREBOARD_LIMIT}`, { ttlSeconds: this.#ttl.temporada, allowStale: true });
    stale('partidos', scoreboard.source);
    const events = scoreboard.data.events ?? [];
    if (events.length >= SCOREBOARD_LIMIT) {
      issues.push({ severity: 'error', code: 'ESPN_LIMIT_REACHED', entityRef: `espn:${league}:${season}`, message: `El scoreboard devolvió ${events.length} partidos (límite ${SCOREBOARD_LIMIT}); puede haber partidos faltantes` });
    }

    const mapped = mapEspnSeason({
      seasonTypes,
      standings: standings.data,
      events,
      season,
      stageNames: comp.nombresFase,
      groupNames: comp.nombresGrupo,
    });
    this.#logger.info(`ESPN ${comp.liga} ${season}: ${mapped.matches.length} partidos, ${mapped.stages.length} fases, ${mapped.groups.length} grupos`);

    return {
      provider: this.id,
      competitionCode: request.competitionCode,
      season,
      hasEventDetail: true,
      ...mapped,
      issues: [...issues, ...mapped.issues],
    };
  }
}
