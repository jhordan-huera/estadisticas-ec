import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headToHeadView, lineupsView } from '../../src/content/views.ts';
import { formats } from '../../src/design/tokens.ts';
import { slidesFor } from '../../src/render/index.ts';
import { teamEventStats } from '../../src/stats/team.ts';
import type { StatLineup } from '../../src/stats/types.ts';
import { A, B, C, ctxFor, event, match, player, season } from '../helpers.ts';

const brand = { name: 'Datazo EC', handle: '@prueba', disclaimer: 'No afiliados a la LigaPro ni a los clubes' };
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

describe('alineaciones confirmadas', () => {
  const lineup = (teamId: number): StatLineup => ({
    teamId,
    formation: '4-4-2',
    players: Array.from({ length: 11 }, (_, i) => ({ playerId: teamId * 100 + i, name: `J${i}`, jersey: String(i + 1), position: i === 0 ? 'G' : null, formationPlace: i + 1, starter: true })),
  });

  it('arma un carrusel con una imagen por equipo, primero el local', () => {
    const m = match(A, B, null, '2026-08-01T20:00:00Z', { id: 31 });
    const ctx = ctxFor(season([m], { lineups: new Map([[31, [lineup(A.id), lineup(B.id)]]]) }));
    const view = lineupsView(ctx, m);
    assert.deepEqual(view.home.rows.map((r) => r.length), [1, 4, 4, 2]);
    const [first, second] = slidesFor(view, formats.vertical, brand).map((s) => JSON.stringify(s));
    assert.ok(first!.includes('"LOCAL"') && first!.indexOf(A.shortName) < first!.indexOf(B.shortName));
    assert.ok(second!.includes('"VISITANTE"') && second!.indexOf(B.shortName) < second!.indexOf(A.shortName));
    assert.equal(slidesFor(view, formats.cuadrado, brand).length, 2);
  });

  it('avisa si falta la alineación de un equipo en vez de publicar media cancha', () => {
    const m = match(A, B, null, '2026-08-01T20:00:00Z', { id: 32 });
    const ctx = ctxFor(season([m], { lineups: new Map([[32, [lineup(A.id)]]]) }));
    assert.throws(() => lineupsView(ctx, m), /no tiene alineación/);
  });

  it('viste a cada equipo con la camiseta del partido y un dorsal legible', () => {
    const m = match(A, B, null, '2026-08-01T20:00:00Z', { id: 33 });
    const home = { ...lineup(A.id), kitColor: '#d10c29', kitDetail: '#f8f8ff' };
    const away = { ...lineup(B.id), kitColor: '#c6fcff', kitDetail: null };
    const view = lineupsView(ctxFor(season([m], { lineups: new Map([[33, [home, away]]]) })), m);
    assert.deepEqual(view.home.kit, { fill: '#d10c29', number: '#f8f8ff', trim: '#f8f8ff' });
    // Camiseta clara sin color de detalle: dorsal oscuro.
    assert.equal(view.away.kit.fill, '#c6fcff');
    assert.notEqual(view.away.kit.number, '#ffffff');
    // Sin datos del partido, los colores del club.
    const plain = lineupsView(ctxFor(season([m], { lineups: new Map([[33, [lineup(A.id), lineup(B.id)]]]) })), m);
    assert.equal(plain.home.kit.fill, A.color);
  });
});
