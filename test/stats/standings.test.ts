import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_TABLE_RULES } from '../../src/core/config.ts';
import { seasonTables } from '../../src/stats/season.ts';
import { computeStandings, positionChanges } from '../../src/stats/standings.ts';
import { A, B, C, D, match, season } from '../helpers.ts';

const names = new Map([A, B, C, D].map((t) => [t.id, t.name]));
const opts = { teamIds: [A.id, B.id, C.id, D.id], rules: DEFAULT_TABLE_RULES, teamNames: names };

describe('tabla de posiciones', () => {
  it('suma puntos, goles y partidos solo de partidos finalizados', () => {
    const rows = computeStandings(
      [
        match(A, B, [2, 0], '2026-03-01T20:00:00Z'),
        match(C, D, [1, 1], '2026-03-01T22:00:00Z'),
        match(A, C, null, '2026-03-08T20:00:00Z'), // programado: no cuenta
        match(B, D, [3, 3], '2026-03-08T20:00:00Z', { status: 'live' }), // en vivo: no cuenta
      ],
      opts,
    );
    const a = rows.find((r) => r.teamId === A.id)!;
    assert.deepEqual([a.played, a.won, a.points, a.goalsFor, a.goalsAgainst, a.goalDiff], [1, 1, 3, 2, 0, 2]);
    assert.equal(rows[0]!.teamId, A.id);
    const c = rows.find((r) => r.teamId === C.id)!;
    assert.deepEqual([c.played, c.drawn, c.points], [1, 1, 1]);
    assert.equal(rows.find((r) => r.teamId === B.id)!.played, 1);
  });

  it('incluye a los equipos sin partidos con cero puntos', () => {
    const rows = computeStandings([match(A, B, [1, 0], '2026-03-01T20:00:00Z')], opts);
    assert.equal(rows.length, 4);
    assert.equal(rows.find((r) => r.teamId === D.id)!.played, 0);
  });

  it('desempata por diferencia de gol y luego por goles a favor', () => {
    const rows = computeStandings(
      [
        match(A, D, [3, 1], '2026-03-01T20:00:00Z'), // A: +2, 3 GF
        match(B, C, [2, 0], '2026-03-01T20:00:00Z'), // B: +2, 2 GF
      ],
      opts,
    );
    assert.deepEqual(rows.slice(0, 2).map((r) => r.teamId), [A.id, B.id]);
  });

  it('usa el enfrentamiento directo entre los empatados antes que los goles de visitante', () => {
    // A y B terminan con 3 puntos, misma diferencia y mismos goles; B le ganó a A.
    const rows = computeStandings(
      [
        match(A, B, [0, 1], '2026-03-01T20:00:00Z'),
        match(A, C, [1, 0], '2026-03-08T20:00:00Z'),
        match(B, D, [0, 1], '2026-03-08T20:00:00Z'),
      ],
      opts,
    );
    const a = rows.find((r) => r.teamId === A.id)!;
    const b = rows.find((r) => r.teamId === B.id)!;
    assert.deepEqual([a.points, a.goalDiff, a.goalsFor], [b.points, b.goalDiff, b.goalsFor]);
    assert.ok(b.position < a.position, 'B debe quedar arriba por el duelo directo');
  });

  it('cae al orden alfabético cuando todo lo demás es igual', () => {
    const rows = computeStandings([], opts);
    assert.deepEqual(rows.map((r) => r.teamId), [A.id, B.id, C.id, D.id]);
  });

  it('aplica sanciones de puntos', () => {
    const rows = computeStandings([match(A, B, [1, 0], '2026-03-01T20:00:00Z')], {
      ...opts,
      adjustments: [{ teamId: A.id, points: -6, reason: 'Sanción', effectiveFrom: '2026-02-01T00:00:00Z' }],
    });
    const a = rows.find((r) => r.teamId === A.id)!;
    assert.equal(a.points, -3);
    assert.equal(a.adjustment, -6);
    assert.equal(rows.at(-1)!.teamId, A.id);
  });

  it('calcula la tabla a una fecha dada y el movimiento de puestos', () => {
    const matches = [match(A, B, [1, 0], '2026-03-01T20:00:00Z'), match(B, A, [3, 0], '2026-03-08T20:00:00Z')];
    const before = computeStandings(matches, { ...opts, until: '2026-03-05T00:00:00Z' });
    const now = computeStandings(matches, opts);
    assert.equal(before[0]!.teamId, A.id);
    assert.equal(now[0]!.teamId, B.id);
    // Antes: A, C, D, B (B último por diferencia de gol). Ahora B es primero: sube 3 puestos.
    assert.equal(positionChanges(now, before).get(B.id), 3);
  });

  it('guarda los últimos 5 resultados en orden cronológico', () => {
    const results: [number, number][] = [[1, 0], [0, 0], [0, 2], [2, 1], [1, 1], [3, 0]];
    const matches = results.map((s, i) => match(A, B, s, `2026-03-${String(i + 1).padStart(2, '0')}T20:00:00Z`));
    const a = computeStandings(matches, opts).find((r) => r.teamId === A.id)!;
    assert.deepEqual(a.form, ['D', 'L', 'W', 'D', 'W']);
  });

  it('en fase de grupos con puntos acumulados arrastra la primera fase', () => {
    const data = season(
      [
        match(A, C, [2, 0], '2026-03-01T20:00:00Z', { stageId: 1 }),
        match(B, D, [0, 0], '2026-03-01T20:00:00Z', { stageId: 1 }),
        match(A, B, [0, 1], '2026-10-01T20:00:00Z', { stageId: 2, groupId: 9 }),
      ],
      {
        stages: [
          { id: 1, name: 'Primera fase', kind: 'league', order: 1 },
          { id: 2, name: 'Fase final', kind: 'groups', order: 2 },
        ],
        groups: [{ id: 9, stageId: 2, name: 'Grupo 1', teamIds: [A.id, B.id] }],
      },
    );
    const acumulada = seasonTables(data, DEFAULT_TABLE_RULES);
    assert.equal(acumulada.current[0]!.label, 'Grupo 1');
    assert.deepEqual(acumulada.groups[0]!.rows.map((r) => [r.teamId, r.points]), [
      [B.id, 4],
      [A.id, 3],
    ]);
    const reiniciada = seasonTables(data, { ...DEFAULT_TABLE_RULES, puntosFaseFinal: 'reiniciados' });
    assert.deepEqual(reiniciada.groups[0]!.rows.map((r) => [r.teamId, r.points]), [
      [B.id, 3],
      [A.id, 0],
    ]);
  });
});
