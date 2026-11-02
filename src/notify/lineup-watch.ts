// Avisos del seguimiento de alineaciones: cuándo se empieza a buscarlas para un partido y, si la
// fuente nunca las publica, que esta vez no habrá carrusel. Cada aviso sale una sola vez por partido.

import type { AppContext } from '../app.ts';
import { toLocal } from '../core/time.ts';
import { many, run } from '../db/connection.ts';
import { LineupsRepo } from '../db/repositories/lineups.ts';
import { notifyAll, type Notifier } from './notifier.ts';

const DEFAULT_HOURS_BEFORE = 2;
/** Mismo margen que la búsqueda: tras el inicio se sigue intentando un rato. */
const MINUTES_AFTER_KICKOFF = 30;
/** Pasado este tiempo de juego, la publicación de alineaciones ya venció. */
const GIVE_UP_MINUTES = 45;

interface WatchedMatch {
  id: number;
  kickoff_utc: string;
  home: string;
  away: string;
}

export async function lineupWatchNotices(app: AppContext, now: Date, notifiers: Notifier[]): Promise<number> {
  if (notifiers.length === 0) return 0;
  const codes = Object.entries(app.config.file.publicacion.competiciones)
    .filter(([, kinds]) => kinds.includes('alineaciones'))
    .map(([code]) => code);
  if (codes.length === 0) return 0;

  const hours = app.config.file.publicacion.alineacionesHorasAntes ?? DEFAULT_HOURS_BEFORE;
  const tz = app.config.file.zonaHoraria;
  const inCodes = codes.map((_, i) => `:c${i}`).join(', ');
  const codeParams = Object.fromEntries(codes.map((c, i) => [`c${i}`, c]));
  const select = `SELECT m.id, m.kickoff_utc, h.short_name AS home, a.short_name AS away FROM matches m
    JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
    JOIN stages s ON s.id = m.stage_id JOIN seasons se ON se.id = s.season_id JOIN competitions c ON c.id = se.competition_id
    LEFT JOIN lineup_watch w ON w.match_id = m.id
    WHERE c.code IN (${inCodes}) AND se.year = :season`;
  const season = app.config.file.temporada;
  let sent = 0;

  const starting = many<WatchedMatch>(
    app.db,
    `${select} AND w.match_id IS NULL AND m.status IN ('scheduled', 'live') AND m.kickoff_utc BETWEEN :from AND :to ORDER BY m.kickoff_utc`,
    {
      ...codeParams,
      season,
      from: new Date(now.getTime() - MINUTES_AFTER_KICKOFF * 60_000).toISOString(),
      to: new Date(now.getTime() + hours * 3_600_000).toISOString(),
    },
  );
  for (const m of starting) {
    const time = toLocal(m.kickoff_utc, tz).time;
    const notice = {
      title: `Buscando alineaciones: ${m.home} vs ${m.away}`,
      message: `El partido empieza a las ${time}. Consulto ESPN cada pocos minutos y publico el carrusel en cuanto salgan los dos onces.`,
    };
    if ((await notifyAll(notifiers, notice, app.logger)).sent.length === 0) continue;
    run(app.db, 'INSERT INTO lineup_watch (match_id, started_at) VALUES (:m, :t)', { m: m.id, t: now.toISOString() });
    sent++;
  }

  const overdue = many<WatchedMatch>(
    app.db,
    `${select} AND w.match_id IS NOT NULL AND w.closed_at IS NULL AND m.kickoff_utc <= :limit`,
    { ...codeParams, season, limit: new Date(now.getTime() - GIVE_UP_MINUTES * 60_000).toISOString() },
  );
  const complete = new LineupsRepo(app.db).completeMatches(overdue.map((m) => m.id));
  const close = (matchId: number, outcome: string) =>
    run(app.db, 'UPDATE lineup_watch SET closed_at = :t, outcome = :o WHERE match_id = :m', { m: matchId, t: now.toISOString(), o: outcome });
  for (const m of overdue) {
    if (complete.has(m.id)) {
      // Salieron a tiempo: el aviso de la publicación ya lo contó.
      close(m.id, 'encontradas');
      continue;
    }
    const notice = {
      title: `Sin alineaciones: ${m.home} vs ${m.away}`,
      message: `ESPN no publicó los dos onces antes de los ${GIVE_UP_MINUTES} minutos de juego; esta vez no sale el carrusel.`,
    };
    if ((await notifyAll(notifiers, notice, app.logger)).sent.length === 0) continue;
    close(m.id, 'sin-alineaciones');
    sent++;
  }
  return sent;
}
