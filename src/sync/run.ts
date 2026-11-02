// Ejecuta la sincronización de las competiciones configuradas, una por una.
// El fallo de una competición queda registrado y no impide sincronizar las demás.

import type { AppContext } from '../app.ts';
import { describeError } from '../core/errors.ts';
import { nowIso, run } from '../db/connection.ts';
import { ingestSnapshot, type IngestSummary } from './ingest.ts';

export interface SyncOutcome {
  code: string;
  ok: boolean;
  summary?: IngestSummary;
  error?: string;
}

export async function syncCompetitions(app: AppContext, options: { codes?: string[]; season?: number } = {}): Promise<SyncOutcome[]> {
  const { config, logger, db } = app;
  const season = options.season ?? config.file.temporada;
  const codes = options.codes?.length ? options.codes : Object.keys(config.file.competiciones);
  const outcomes: SyncOutcome[] = [];

  for (const code of codes) {
    const competition = config.file.competiciones[code];
    if (!competition) {
      outcomes.push({ code, ok: false, error: `Competición no configurada: ${code}` });
      logger.error(`Competición no configurada: ${code}`);
      continue;
    }
    const startedAt = nowIso();
    const runId = run(db, 'INSERT INTO sync_runs (job, started_at) VALUES (:job, :t)', { job: `sincronizar:${code}:${season}`, t: startedAt }).lastId;
    try {
      const snapshot = await app.providers().get(competition.proveedor).fetchSeason({ competitionCode: code, competition, season });
      const summary = ingestSnapshot(db, snapshot, { competition, teamOverrides: config.teams, logger: logger.child(code), runStartedAt: startedAt });
      run(db, 'UPDATE sync_runs SET finished_at = :t, ok = 1, summary = :s WHERE id = :id', { t: nowIso(), s: JSON.stringify(summary), id: runId });
      outcomes.push({ code, ok: true, summary });
    } catch (err) {
      const error = describeError(err);
      logger.error(`Sincronización de ${code} fallida: ${error}`);
      run(db, 'UPDATE sync_runs SET finished_at = :t, ok = 0, summary = :s WHERE id = :id', { t: nowIso(), s: JSON.stringify({ error }), id: runId });
      outcomes.push({ code, ok: false, error });
    }
  }
  return outcomes;
}
