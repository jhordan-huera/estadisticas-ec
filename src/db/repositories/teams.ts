// Identidad de equipos entre proveedores. Un mismo club puede venir de ESPN y de
// TheSportsDB con nombres distintos; se enlaza por id de proveedor, por alias
// configurado o por nombre normalizado, y cada enlace nuevo queda registrado.

import type { TeamOverride } from '../../core/config.ts';
import { teamNameKey } from '../../core/text.ts';
import type { ProviderIssue, ProviderPlayer, ProviderTeam } from '../../providers/types.ts';
import { many, nowIso, one, run, type Db } from '../connection.ts';

export interface TeamRow {
  id: number;
  name: string;
  short_name: string;
  abbr: string;
  color: string | null;
  alt_color: string | null;
  text_color: string | null;
}

export class TeamsRepo {
  #db: Db;
  #overrides: Record<string, TeamOverride>;

  constructor(db: Db, overrides: Record<string, TeamOverride> = {}) {
    this.#db = db;
    this.#overrides = overrides;
  }

  /** Devuelve el id interno del equipo; lo enlaza o lo crea si es nuevo. */
  resolve(provider: string, team: ProviderTeam, issues: ProviderIssue[]): number {
    const override = this.#overrides[`${provider}:${team.externalId}`];
    const linked = one<{ team_id: number }>(this.#db, 'SELECT team_id FROM team_provider_ids WHERE provider = :p AND external_id = :e', {
      p: provider,
      e: team.externalId,
    });
    if (linked) {
      this.#refresh(linked.team_id, team, override);
      return linked.team_id;
    }

    const candidates = this.#matchByName(team.name);
    let teamId: number;
    if (candidates.length === 1) {
      teamId = candidates[0]!;
      issues.push({
        severity: 'info',
        code: 'TEAM_LINKED_BY_NAME',
        entityRef: `${provider}:team:${team.externalId}`,
        message: `"${team.name}" (${provider}) se enlazó con el equipo existente #${teamId}`,
      });
    } else {
      teamId = this.#create(team, override);
      if (candidates.length > 1) {
        issues.push({
          severity: 'warning',
          code: 'TEAM_NAME_AMBIGUOUS',
          entityRef: `${provider}:team:${team.externalId}`,
          message: `"${team.name}" coincide con varios equipos (${candidates.join(', ')}); se creó uno nuevo. Añade un alias en config/equipos.json`,
        });
      }
    }
    run(this.#db, 'INSERT INTO team_provider_ids (provider, external_id, team_id, provider_name) VALUES (:p, :e, :t, :n)', {
      p: provider,
      e: team.externalId,
      t: teamId,
      n: team.name,
    });
    return teamId;
  }

  get(id: number): TeamRow | undefined {
    return one<TeamRow>(this.#db, 'SELECT id, name, short_name, abbr, color, alt_color, text_color FROM teams WHERE id = :id', { id });
  }

  all(): TeamRow[] {
    return many<TeamRow>(this.#db, 'SELECT id, name, short_name, abbr, color, alt_color, text_color FROM teams ORDER BY name');
  }

  resolvePlayer(provider: string, player: ProviderPlayer, teamId: number | null): number {
    const linked = one<{ player_id: number }>(this.#db, 'SELECT player_id FROM player_provider_ids WHERE provider = :p AND external_id = :e', {
      p: provider,
      e: player.externalId,
    });
    const now = nowIso();
    const shortName = player.shortName ?? player.name;
    if (linked) {
      run(this.#db, 'UPDATE players SET name = :n, short_name = :s, team_id = COALESCE(:t, team_id), updated_at = :now WHERE id = :id', {
        n: player.name,
        s: shortName,
        t: teamId,
        now,
        id: linked.player_id,
      });
      return linked.player_id;
    }
    const { lastId } = run(this.#db, 'INSERT INTO players (name, short_name, team_id, created_at, updated_at) VALUES (:n, :s, :t, :now, :now)', {
      n: player.name,
      s: shortName,
      t: teamId,
      now,
    });
    run(this.#db, 'INSERT INTO player_provider_ids (provider, external_id, player_id) VALUES (:p, :e, :id)', { p: provider, e: player.externalId, id: lastId });
    return lastId;
  }

  #create(team: ProviderTeam, override: TeamOverride | undefined): number {
    const now = nowIso();
    return run(
      this.#db,
      `INSERT INTO teams (name, short_name, abbr, color, alt_color, text_color, created_at, updated_at)
       VALUES (:name, :short, :abbr, :color, :alt, :text, :now, :now)`,
      {
        name: override?.nombre ?? team.name,
        short: override?.corto ?? team.shortName,
        abbr: override?.abrev ?? team.abbr,
        color: override?.color ?? team.color ?? null,
        alt: team.altColor ?? null,
        text: override?.texto ?? null,
        now,
      },
    ).lastId;
  }

  /** La configuración manda sobre nombres y colores; sin configuración solo se completan colores que falten. */
  #refresh(teamId: number, team: ProviderTeam, override: TeamOverride | undefined): void {
    if (override) {
      run(
        this.#db,
        `UPDATE teams SET name = :name, short_name = :short, abbr = :abbr, color = :color,
           alt_color = COALESCE(:alt, alt_color), text_color = :text, updated_at = :now
         WHERE id = :id AND (name <> :name OR short_name <> :short OR abbr <> :abbr
           OR color IS NOT :color OR text_color IS NOT :text OR (:alt IS NOT NULL AND alt_color IS NOT :alt))`,
        {
          id: teamId,
          name: override.nombre ?? team.name,
          short: override.corto ?? team.shortName,
          abbr: override.abrev ?? team.abbr,
          color: override.color ?? team.color ?? null,
          alt: team.altColor ?? null,
          text: override.texto ?? null,
          now: nowIso(),
        },
      );
    } else if (team.color) {
      run(this.#db, 'UPDATE teams SET color = :c, updated_at = :now WHERE id = :id AND color IS NULL', { c: team.color, id: teamId, now: nowIso() });
    }
  }

  #matchByName(name: string): number[] {
    const key = teamNameKey(name);
    if (!key) return [];
    const ids = new Set<number>();
    for (const t of this.all()) {
      if (teamNameKey(t.name) === key || teamNameKey(t.short_name) === key) ids.add(t.id);
    }
    for (const row of many<{ team_id: number; provider_name: string }>(this.#db, 'SELECT team_id, provider_name FROM team_provider_ids')) {
      if (teamNameKey(row.provider_name) === key) ids.add(row.team_id);
    }
    for (const [ref, override] of Object.entries(this.#overrides)) {
      const names = [override.nombre, override.corto, ...(override.alias ?? [])].filter((n): n is string => Boolean(n));
      if (!names.some((n) => teamNameKey(n) === key)) continue;
      const [provider, externalId] = ref.split(':');
      const linked = one<{ team_id: number }>(this.#db, 'SELECT team_id FROM team_provider_ids WHERE provider = :p AND external_id = :e', {
        p: provider ?? '',
        e: externalId ?? '',
      });
      if (linked) ids.add(linked.team_id);
    }
    return [...ids];
  }
}
