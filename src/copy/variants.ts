// Selección determinista de variantes y relleno de plantillas.
// La misma publicación (misma semilla) produce siempre el mismo texto; publicaciones
// distintas reparten las variantes de forma estable. Sin azar ni servicios externos.

/** FNV-1a de 32 bits: rápido, estable entre ejecuciones y plataformas. */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function pick<T>(options: readonly T[], seed: string): T {
  if (options.length === 0) throw new Error(`No hay variantes para la semilla ${seed}`);
  return options[stableHash(seed) % options.length]!;
}

export type Vars = Record<string, string | number>;

/**
 * Sustituye {clave}. Una clave sin valor es un error: nunca se publica un texto a medias.
 * Corrige el doble punto que aparece cuando un nombre termina en "." ("Técnico U.").
 */
export function fill(template: string, vars: Vars): string {
  return template
    .replace(/\{(\w+)\}/g, (_match, key: string) => {
      if (!(key in vars)) throw new Error(`Falta la variable {${key}} en la plantilla: "${template}"`);
      return String(vars[key]);
    })
    .replace(/(?<!\.)\.\.(?!\.)/g, '.');
}

export function pickAndFill(options: readonly string[], seed: string, vars: Vars): string {
  return fill(pick(options, seed), vars);
}
