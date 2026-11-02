import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headToHeadView } from '../../src/content/views.ts';
import { formats } from '../../src/design/tokens.ts';
import { slidesFor } from '../../src/render/index.ts';
import { teamEventStats } from '../../src/stats/team.ts';
import { A, B, C, ctxFor, event, match, player, season } from '../helpers.ts';

const brand = { name: 'Estadísticas EC', handle: '@prueba', disclaimer: 'No afiliados a la LigaPro ni a los clubes' };
const p1 = player(1, 'Ana', A.id);
const p2 = player(2, 'Beto', A.id);
const players = new Map([p1, p2].map((p) => [p.id, p]));

describe('datos de eventos por equipo', () => {
  it('goleador, tarjetas y goles por tiempo (45+x cuenta como primer tiempo)', () => {
    const m1 = match(A, B, [3, 1], '2026-03-01T20:00:00Z');
    const m2 = match(C, A, [0, 1], '2026-03-08T20:00:00Z');
    const events = [
      event(m1, 'goal', A.id, 1, 10),
      event(m1, 'goal', A.id, 1, 45, 2),
      event(m1, 'penalty_goal', A.id, 2, 70),
      event(m1, 'goal', B.id, null, 80),
      event(m1, 'red_card', A.id, 2, 88),
      event(m2, 'own_goal', A.id, null, 60),
      event(m2, 'yellow_card', A.id, 1, 30),
    ];
    const s = teamEventStats(A.id, [m1, m2], events, players);
    assert.deepEqual(s.topScorer, { playerId: 1, name: 'Ana', goals: 2 });
    assert.deepEqual([s.goalsFirstHalf, s.goalsSecondHalf, s.redCards, s.yellowCards], [2, 2, 1, 1]);
  });
});

describe('previa en carrusel', () => {
  it('tiene 3 imágenes si ya se enfrentaron y 2 si es el primer cruce', () => {
    const past = match(A, B, [2, 0], '2026-03-01T20:00:00Z');
    const next = match(B, A, null, '2026-08-01T20:00:00Z');
    const first = match(A, C, null, '2026-08-02T20:00:00Z');
    const ctx = ctxFor(season([past, next, first]));
    assert.equal(slidesFor(headToHeadView(ctx, next), formats.vertical, brand).length, 3);
    assert.equal(slidesFor(headToHeadView(ctx, first), formats.vertical, brand).length, 2);
  });

  it('la comparativa resalta el lado correcto según si el valor alto o bajo es mejor', () => {
    const ctx = ctxFor(season([match(A, B, [3, 0], '2026-03-01T20:00:00Z'), match(B, A, null, '2026-08-01T20:00:00Z')]));
    const view = headToHeadView(ctx, ctx.data.matches[1]!);
    const row = (label: string) => view.comparison.find((r) => r.label === label)!;
    assert.deepEqual([row('Goles a favor').home, row('Goles a favor').away], [0, 3]); // local = B
    assert.equal(row('Goles en contra').better, 'lower');
    assert.equal(view.previous.length, 1);
    assert.equal(view.homeSide.record, '0G 0E 1P');
  });
});
