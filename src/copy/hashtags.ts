// Hashtags configurables: base + por tipo de publicación + uno por equipo mencionado.

import type { CopyConfig, TeamOverride } from '../core/config.ts';
import type { TeamVisual } from '../design/components/team.ts';

/** "Liga de Quito" → "#LigaDeQuito"; "Barcelona SC" → "#BarcelonaSC". */
export function deriveHashtag(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return '#' + words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export function teamHashtagMap(overrides: Record<string, TeamOverride>): Map<string, string> {
  const map = new Map<string, string>();
  for (const o of Object.values(overrides)) if (o.abrev && o.hashtag) map.set(o.abrev, o.hashtag);
  return map;
}

export function hashtagsFor(kind: string, teams: TeamVisual[], config: CopyConfig['hashtags'], custom: Map<string, string>): string[] {
  const tags = [...config.base, ...(config.porTipo?.[kind] ?? [])];
  if (config.equipos) for (const t of teams) tags.push(custom.get(t.abbr) ?? deriveHashtag(t.name));
  const seen = new Set<string>();
  const unique = tags.filter((t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, config.maximo);
}
