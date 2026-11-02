// Contraste de nuestra tabla con la que publica el proveedor. Cada diferencia de
// partidos jugados, puntos o goles queda registrada como incidencia.

import { DEFAULT_TABLE_RULES, type AppConfig, type TableRules } from '../core/config.ts';
import { many, nowIso, type Db } from '../db/connection.ts';
import { IssuesRepo } from '../db/repositories/issues.ts';
import type { ProviderIssue } from '../providers/types.ts';
import { seasonTables } from './season.ts';
import type { SeasonData } from './types.ts';

export function tableRulesFor(config: AppConfig, competitionCode: string): TableRules {
  const comp = config.file.competiciones[competitionCode];
  const custom = comp && comp.proveedor === 'espn' ? comp.tabla : undefined;
  return { ...DEFAULT_TABLE_RULES, ...custom };
}

export interface VerifyResult {
  compared: number;
  mismatches: ProviderIssue[];
}

export function verifyAgainstProvider(db: Db, data: SeasonData, rules: TableRules): VerifyResult {
  const tables = seasonTables(data, rules);
  const stageIds = data.stages.map((s) => s.id);
  if (stageIds.length === 0) return { compared: 0, mismatches: [] };
  const reference = many<{ stage_id: number; group_id: number | null; team_id: number; played: number | null; points: number | null; goals_for: number | null; goals_against: number | null }>(
    db,
    `SELECT stage_id, group_id, team_id, played, points, goals_for, goals_against FROM provider_standings WHERE stage_id IN (${stageIds.join(',')})`,
  );

  const mismatches: ProviderIssue[] = [];
  let compared = 0;
  for (const ref of reference) {
    const rows = ref.group_id !== null ? tables.groups.find((g) => g.group.id === ref.group_id)?.rows : tables.overall;
    const ours = rows?.find((r) => r.teamId === ref.team_id);
    const team = data.teams.get(ref.team_id)?.shortName ?? `#${ref.team_id}`;
    if (!ours) {
      mismatches.push({ severity: 'warning', code: 'TABLE_TEAM_MISSING', entityRef: `stats:${data.competitionCode}:team:${ref.team_id}`, message: `${team} aparece en la tabla del proveedor pero no en la nuestra` });
      continue;
    }
    compared++;
    const diffs: string[] = [];
    if (ref.played !== null && ref.played !== ours.played) diffs.push(`PJ ${ours.played} vs ${ref.played}`);
    if (ref.points !== null && ref.points !== ours.points) diffs.push(`Pts ${ours.points} vs ${ref.points}`);
    if (ref.goals_for !== null && ref.goals_for !== ours.goalsFor) diffs.push(`GF ${ours.goalsFor} vs ${ref.goals_for}`);
    if (ref.goals_against !== null && ref.goals_against !== ours.goalsAgainst) diffs.push(`GC ${ours.goalsAgainst} vs ${ref.goals_against}`);
    if (diffs.length) {
      mismatches.push({
        severity: 'warning',
        code: 'TABLE_MISMATCH',
        entityRef: `stats:${data.competitionCode}:team:${ref.team_id}`,
        message: `${team}: nuestra tabla difiere de la del proveedor (${diffs.join(', ')}). Revisa partidos faltantes o sanciones (point_adjustments)`,
      });
    }
  }
  return { compared, mismatches };
}

export function recordVerification(db: Db, data: SeasonData, result: VerifyResult): number {
  const repo = new IssuesRepo(db);
  const source = `stats:${data.competitionCode}`;
  const started = nowIso();
  for (const issue of result.mismatches) repo.record(source, issue, started);
  return repo.resolveNotSeenSince(source, started);
}
