// Alineaciones: se consultan solo para partidos que empiezan pronto y aún no las tienen.
// Se guardan cuando ambos equipos tienen sus 11 titulares; antes, se vuelve a consultar.

import type { AppContext } from '../app.ts';
import { describeError } from '../core/errors.ts';
import { many, transaction } from '../db/connection.ts';
import { LineupsRepo, STARTERS } from '../db/repositories/lineups.ts';
import { TeamsRepo } from '../db/repositories/teams.ts';

export interface LineupSyncResult {
  checked: number;
  stored: number;
  errors: number;
}

const DEFAULT_HOURS_BEFORE = 2;
/** Tras el inicio se sigue intentando un rato, por si se publican tarde. */
const MINUTES_AFTER_KICKOFF = 30;

export async function syncLineups(
  app: AppContext,
  code: string,
  options: { now?: Date; matchExternalId?: string; season?: number } = {},
): Promise<LineupSyncResult> {
  const competition = app.config.file.competiciones[code];
  const result: LineupSyncResult = { checked: 0, stored: 0, errors: 0 };
  if (!competition) return result;
  const provider = app.providers().get(competition.proveedor);
  if (!provider.fetchLineups) return result;

  const now = options.now ?? new Date();
  const hours = app.config.file.publicacion.alineacionesHorasAntes ?? DEFAULT_HOURS_BEFORE;
  const from = new Date(now.getTime() - MINUTES_AFTER_KICKOFF * 60_000).toISOString();
  const to = new Date(now.getTime() + hours * 3_600_000).toISOString();
  const season = options.season ?? app.config.file.temporada;

  const candidates = many<{ id: number; external_id: string; home_team_id: number; away_team_id: number }>(
    app.db,
    `SELECT m.id, m.external_id, m.home_team_id, m.away_team_id FROM matches m
     JOIN stages s ON s.id = m.stage_id JOIN seasons se ON se.id = s.season_id JOIN competitions c ON c.id = se.competition_id
     WHERE c.code = :code AND se.year = :season AND m.provider = :provider
       AND ${options.matchExternalId ? 'm.external_id = :ext' : "m.status IN ('scheduled', 'live') AND m.kickoff_utc BETWEEN :from AND :to"}`,
    options.matchExternalId
      ? { code, season, provider: provider.id, ext: options.matchExternalId }
      : { code, season, provider: provider.id, from, to },
  );
  const lineups = new LineupsRepo(app.db);
  const done = options.matchExternalId ? new Set<number>() : lineups.completeMatches(candidates.map((c) => c.id));
  const teams = new TeamsRepo(app.db, app.config.teams);
  const teamIdOf = (ext: string) =>
    many<{ team_id: number }>(app.db, 'SELECT team_id FROM team_provider_ids WHERE provider = :p AND external_id = :e', { p: provider.id, e: ext })[0]?.team_id;

  for (const match of candidates) {
    if (done.has(match.id)) continue;
    result.checked++;
    try {
      const data = await provider.fetchLineups({ competition, matchExternalId: match.external_id });
      const complete = data.length === 2 && data.every((l) => l.players.filter((p) => p.starter).length >= STARTERS);
      if (!complete) {
        app.logger.debug(`Alineaciones de ${match.external_id}: aún no publicadas`);
        continue;
      }
      transaction(app.db, () => {
        for (const l of data) {
          const teamId = teamIdOf(l.teamExternalId);
          if (teamId === undefined || (teamId !== match.home_team_id && teamId !== match.away_team_id)) {
            throw new Error(`equipo ${l.teamExternalId} no corresponde al partido`);
          }
          lineups.save(
            match.id,
            teamId,
            l.formation,
            l.players.map((p) => ({
              playerId: teams.ensurePlayer(provider.id, { externalId: p.externalId, name: p.name, shortName: p.shortName }, teamId),
              name: p.shortName,
              jersey: p.jersey,
              position: p.position,
              formationPlace: p.formationPlace,
              starter: p.starter,
            })),
          );
        }
      });
      result.stored++;
      app.logger.info(`Alineaciones guardadas: partido ${match.external_id}`);
    } catch (err) {
      result.errors++;
      app.logger.warn(`No se pudieron obtener las alineaciones de ${match.external_id}: ${describeError(err)}`);
    }
  }
  return result;
}
