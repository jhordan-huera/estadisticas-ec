import { createHash } from 'node:crypto';

/** Clave de comparación de nombres de equipo: sin tildes, sin paréntesis ni sufijos societarios. */
export function teamNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['fc', 'sc', 'club', 'cd', 'f', 'c', 's'].includes(w))
    .join(' ');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** JSON con claves ordenadas, para que el hash no dependa del orden de propiedades. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
