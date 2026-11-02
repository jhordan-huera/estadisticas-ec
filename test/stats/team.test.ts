import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headToHead } from '../../src/stats/head-to-head.ts';
import { currentStreaks, teamProfile, type FormEntry } from '../../src/stats/team.ts';
import { A, B, C, match } from '../helpers.ts';

const day = (n: number) => `2026-03-${String(n).padStart(2, '0')}T20:00:00Z`;

describe('estadísticas por equipo', () => {
  const matches = [
    match(A, B, [2, 0], day(1)), // local, gana, valla invicta
    match(C, A, [1, 1], day(2)), // visita, empata
    match(A, C, [0, 3], day(3)), // local, pierde, no marca
    match(B, A, [0, 1], day(4)), // visita, gana, valla invicta
    match(A, B, [3, 2], day(5)), // local, gana
    match(C, A, [0, 2], day(6)), // visita, gana, valla invicta
  ];
  const p = teamProfile(A.id, matches);

  it('separa rendimiento de local y de visitante', () => {
    assert.deepEqual([p.home.played, p.home.won, p.home.lost, p.home.points, p.home.goalsFor, p.home.goalsAgainst], [3, 2, 1, 6, 5, 5]);
    assert.deepEqual([p.away.played, p.away.won, p.away.drawn, p.away.points, p.away.goalsFor, p.away.goalsAgainst], [3, 2, 1, 7, 4, 1]);
    assert.equal(p.total.points, 13);
  });

  it('cuenta porterías en cero y partidos sin marcar', () => {
    assert.equal(p.total.cleanSheets, 3);
    assert.equal(p.total.failedToScore, 1);
  });

  it('devuelve los últimos 5 en orden cronológico', () => {
    assert.deepEqual(p.last5.map((e) => e.outcome), ['D', 'L', 'W', 'W', 'W']);
    assert.equal(p.last5.at(-1)!.home, false);
  });

  it('calcula las rachas vigentes', () => {
    assert.equal(p.streaks.wins, 3);
    assert.equal(p.streaks.unbeaten, 3);
    assert.equal(p.streaks.losses, 0);
    assert.equal(p.streaks.scoring, 3);
    assert.equal(p.streaks.cleanSheets, 1);
  });

  it('identifica la mayor victoria', () => {
    assert.deepEqual([p.biggestWin!.goalsFor, p.biggestWin!.goalsAgainst], [2, 0]);
    assert.deepEqual([p.biggestLoss!.goalsFor, p.biggestLoss!.goalsAgainst], [0, 3]);
  });

  it('rachas negativas: sin ganar y derrotas', () => {
    const entries = ['W', 'L', 'D', 'L', 'L'].map((o) => ({ outcome: o, goalsFor: 0, goalsAgainst: o === 'L' ? 1 : 0 }) as FormEntry);
    const s = currentStreaks(entries);
    assert.deepEqual([s.losses, s.winless, s.unbeaten, s.wins], [2, 4, 0, 0]);
  });

  it('respeta el corte temporal (`until`)', () => {
    const before = teamProfile(A.id, matches, { until: day(4) });
    assert.equal(before.total.played, 3);
    assert.equal(before.streaks.losses, 1);
  });
});

describe('duelos directos', () => {
  it('resume el historial de la temporada y el próximo cruce', () => {
    const matches = [
      match(A, B, [2, 0], day(1)),
      match(B, A, [1, 1], day(10)),
      match(A, C, [5, 0], day(11)),
      match(A, B, null, day(20)),
    ];
    const h = headToHead(A.id, B.id, matches);
    assert.deepEqual([h.played.length, h.winsA, h.draws, h.winsB, h.goalsA, h.goalsB], [2, 1, 1, 0, 3, 1]);
    assert.equal(h.next?.kickoffUtc, day(20));
  });

  it('para una previa solo considera los partidos anteriores', () => {
    const matches = [match(A, B, [2, 0], day(1)), match(B, A, [1, 1], day(10))];
    assert.equal(headToHead(B.id, A.id, matches, { before: day(5) }).played.length, 1);
  });
});
