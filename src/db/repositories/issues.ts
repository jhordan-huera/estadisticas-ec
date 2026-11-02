// Registro persistente de anomalías de datos. Cada incidencia se identifica por
// (origen, código, entidad): si se repite en cada sincronización, solo suma ocurrencias.
// Las que dejan de aparecer en una sincronización completa se marcan como resueltas.

import type { IssueSeverity, ProviderIssue } from '../../providers/types.ts';
import { many, nowIso, run, type Db } from '../connection.ts';

export interface IssueRow {
  id: number;
  source: string;
  code: string;
  entity_ref: string;
  severity: IssueSeverity;
  message: string;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export class IssuesRepo {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  record(source: string, issue: ProviderIssue, seenAt = nowIso()): void {
    run(
      this.#db,
      `INSERT INTO data_issues (source, code, entity_ref, severity, message, first_seen_at, last_seen_at)
       VALUES (:src, :code, :ref, :sev, :msg, :t, :t)
       ON CONFLICT(source, code, entity_ref) DO UPDATE SET severity = excluded.severity,
         message = excluded.message, occurrences = occurrences + 1,
         last_seen_at = excluded.last_seen_at, resolved_at = NULL`,
      { src: source, code: issue.code, ref: issue.entityRef, sev: issue.severity, msg: issue.message, t: seenAt },
    );
  }

  /** Marca como resueltas las incidencias del origen que no se vieron desde `since`. */
  resolveNotSeenSince(source: string, since: string): number {
    return run(
      this.#db,
      'UPDATE data_issues SET resolved_at = :now WHERE source = :src AND resolved_at IS NULL AND last_seen_at < :since',
      { src: source, since, now: nowIso() },
    ).changes;
  }

  open(minSeverity: IssueSeverity = 'info'): IssueRow[] {
    const levels: IssueSeverity[] = minSeverity === 'error' ? ['error'] : minSeverity === 'warning' ? ['warning', 'error'] : ['info', 'warning', 'error'];
    return many<IssueRow>(
      this.#db,
      `SELECT * FROM data_issues WHERE resolved_at IS NULL AND severity IN (${levels.map((l) => `'${l}'`).join(',')})
       ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, source, code, entity_ref`,
    );
  }
}
