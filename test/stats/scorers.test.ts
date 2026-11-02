import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeScorers, topScorers } from '../../src/stats/scorers.ts';
import { A, B, event, match, player } from '../helpers.ts';

const p1 = player(11, 'Ana Goleadora', A.id);
const p2 = player(12, 'Beto Ariete', B.id);
const p3 = player(13, 'Carla Pivote', B.id);
const players = new Map([p1, p2, p3].map((p) => [p.id, p]));

describe('goleadores', () => {
  it('acumula goles partido a partido, cuenta penales y excluye autogoles', () => {
    const m1 = match(A, B, [2, 1], '2026-03-01T20:00:00Z');
    const m2 = match(B, A, [2, 1], '2026-03-08T20:00:00Z');
    const events = [
      event(m1, 'goal', A.id, p1.id, 10),
      event(m1, 'penalty_goal', A.id, p1.id, 50),
      event(m1, 'goal', B.id, p2.id, 70),
      event(m2, 'goal', B.id, p2.id, 5),
      event(m2, 'own_goal', B.id, p1.id, 30), // autogol de Ana: suma para B, no para Ana
      event(m2, 'goal', A.id, p1.id, 80),
    ];
    const table = computeScorers([m1, m2], events, players);
    const ana = table.rows.find((r) => r.playerId === p1.id)!;
    assert.deepEqual([ana.goals, ana.penalties, ana.matchesWithGoal], [3, 1, 2]);
    assert.equal(table.rows.find((r) => r.playerId === p2.id)!.goals, 2);
    assert.equal(table.ownGoals, 1);
    assert.equal(table.unattributedGoals, 0);
  });

  it('informa los goles sin autor en vez de perderlos', () => {
    const m = match(A, B, [3, 0], '2026-03-01T20:00:00Z');
    // Solo 1 de los 3 goles viene con detalle; otro viene sin jugador.
    const table = computeScorers([m], [event(m, 'goal', A.id, p1.id, 10), event(m, 'goal', A.id, null, 20)], players);
    assert.equal(table.rows[0]!.goals, 1);
    assert.equal(table.unattributedGoals, 2);
  });

  it('ignora partidos no finalizados', () => {
    const live = match(A, B, [1, 0], '2026-03-01T20:00:00Z', { status: 'live' });
    const table = computeScorers([live], [event(live, 'goal', A.id, p1.id, 10)], players);
    assert.equal(table.rows.length, 0);
  });

  it('comparte posición con igual cantidad de goles y ordena por menos penales', () => {
    const m = match(A, B, [2, 2], '2026-03-01T20:00:00Z');
    const events = [
      event(m, 'penalty_goal', A.id, p1.id, 10),
      event(m, 'goal', A.id, p1.id, 20),
      event(m, 'goal', B.id, p2.id, 30),
      event(m, 'goal', B.id, p2.id, 40),
    ];
    const rows = computeScorers([m], events, players).rows;
    assert.deepEqual(rows.map((r) => [r.playerId, r.position]), [
      [p2.id, 1],
      [p1.id, 1],
    ]);
  });

  it('top N avisa cuántos más empatan con el último', () => {
    const m = match(A, B, [1, 2], '2026-03-01T20:00:00Z');
    const events = [event(m, 'goal', A.id, p1.id, 10), event(m, 'goal', B.id, p2.id, 20), event(m, 'goal', B.id, p3.id, 30)];
    const { rows, tiedOutside } = topScorers(computeScorers([m], events, players), 2);
    assert.equal(rows.length, 2);
    assert.equal(tiedOutside, 1);
  });

  it('atribuye al jugador el equipo de su gol más reciente', () => {
    const m1 = match(A, B, [1, 0], '2026-03-01T20:00:00Z');
    const m2 = match(B, A, [1, 0], '2026-08-01T20:00:00Z');
    const rows = computeScorers([m1, m2], [event(m1, 'goal', A.id, p1.id, 10), event(m2, 'goal', B.id, p1.id, 10)], players).rows;
    assert.equal(rows[0]!.teamId, B.id);
  });
});
