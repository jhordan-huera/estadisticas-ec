// Ubicación de los titulares en la cancha según la formación ("4-2-3-1") y la posición de
// cada jugador. Devuelve filas desde el arquero hasta la delantera; en cada fila, de la
// banda izquierda a la derecha del propio equipo.

export interface PlaceablePlayer {
  position: string | null;
  formationPlace: number | null;
}

/** Profundidad de la posición: 0 arquero … 5 delantero. */
export function depthOf(position: string | null): number {
  const base = (position ?? '').toUpperCase().replace(/-[LR]$/, '');
  if (base === 'G' || base === 'GK') return 0;
  if (['CD', 'CB', 'D', 'SW', 'LB', 'RB'].includes(base)) return 1;
  if (['LWB', 'RWB', 'WB'].includes(base)) return 1.5;
  if (['DM', 'CDM'].includes(base)) return 2;
  if (['CM', 'M', 'LM', 'RM'].includes(base)) return 3;
  if (['AM', 'CAM', 'LW', 'RW', 'W'].includes(base)) return 4;
  if (['F', 'CF', 'ST', 'S', 'LF', 'RF'].includes(base)) return 5;
  return 3;
}

/** Posición lateral: -2 banda izquierda … +2 banda derecha. */
export function lateralOf(position: string | null): number {
  const p = (position ?? '').toUpperCase();
  if (/^L(B|WB|M|W|F)$/.test(p)) return -2;
  if (/^R(B|WB|M|W|F)$/.test(p)) return 2;
  if (p.endsWith('-L')) return -1;
  if (p.endsWith('-R')) return 1;
  return 0;
}

export function lineupRows<T extends PlaceablePlayer>(formation: string | null, starters: T[]): T[][] {
  const byPlace = (a: T, b: T) => (a.formationPlace ?? 99) - (b.formationPlace ?? 99);
  const keeper =
    starters.find((p) => depthOf(p.position) === 0) ??
    [...starters].sort(byPlace).find((p) => p.formationPlace === 1) ??
    [...starters].sort(byPlace)[0];
  const outfield = starters.filter((p) => p !== keeper).sort((a, b) => depthOf(a.position) - depthOf(b.position) || byPlace(a, b));

  const counts = (formation ?? '')
    .split('-')
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  let rows: T[][];
  if (counts.length > 0 && counts.reduce((a, b) => a + b, 0) === outfield.length) {
    rows = [];
    let i = 0;
    for (const n of counts) {
      rows.push(outfield.slice(i, i + n));
      i += n;
    }
  } else {
    // Sin formación fiable: una fila por grupo de profundidad.
    const groups = new Map<number, T[]>();
    for (const p of outfield) {
      const d = Math.min(5, Math.max(1, Math.round(depthOf(p.position))));
      groups.set(d, [...(groups.get(d) ?? []), p]);
    }
    rows = [...groups.entries()].sort(([a], [b]) => a - b).map(([, list]) => list);
  }
  const lateral = (a: T, b: T) => lateralOf(a.position) - lateralOf(b.position) || byPlace(a, b);
  return [keeper ? [keeper] : [], ...rows.map((r) => [...r].sort(lateral))].filter((r) => r.length > 0);
}
