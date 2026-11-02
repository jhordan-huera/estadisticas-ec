import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchFacts } from '../../src/stats/match-facts.ts';
import { lastCompletedMatchday, matchdays, summarizeMatchday } from '../../src/stats/matchday.ts';
import { A, B, C, D, event, match, player, season } from '../helpers.ts';

const p1 = player(11, 'Ana', A.id);
const p2 = player(12, 'Beto', B.id);
const players = new Map([p1, p2].map((p) => [p.id, p]));

describe('hechos del partido', () => {
  it('detecta una remontada y el gol decisivo tardío', () => {
    const m = match(A, B, [2, 1], '2026-03-01T20:00:00Z');
    const events = [event(m, 'goal', B.id, p2.id, 10), event(m, 'goal', A.id, p1.id, 60), event(m, 'goal', A.id, p1.id, 90, 3)];
    const f = matchFacts(m, events, players);
    assert.deepEqual(f.comeback, { teamId: A.id, deficit: 1 });
    assert.equal(f.lateWinner?.minuteLabel, "90+3'");
    assert.equal(f.scorers.find((s) => s.playerId === p1.id)!.minutes.length, 2);
  });

  it('detecta goleada y empate sin goles', () => {
    const rout = match(A, B, [4, 1], '2026-03-01T20:00:00Z');
    assert.equal(matchFacts(rout, [], players).isRout, true);
    const nil = match(A, B, [0, 0], '2026-03-01T20:00:00Z');
    const f = matchFacts(nil, [], players);
    assert.equal(f.isGoallessDraw, true);
    assert.equal(f.winnerId, null);
  });

  it('detecta un empate rescatado tras ir abajo', () => {
    const m = match(A, B, [1, 1], '2026-03-01T20:00:00Z');
    const f = matchFacts(m, [event(m, 'goal', A.id, p1.id, 5), event(m, 'goal', B.id, p2.id, 88)], players);
    assert.deepEqual(f.rescuedDraw, { teamId: B.id, deficit: 1 });
    assert.equal(f.comeback, null);
  });

  it('no inventa remontadas si el detalle de goles está incompleto', () => {
    const m = match(A, B, [2, 1], '2026-03-01T20:00:00Z');
    const f = matchFacts(m, [event(m, 'goal', B.id, p2.id, 10)], players);
    assert.equal(f.detailComplete, false);
    assert.equal(f.comeback, null);
  });

  it('marca los autogoles y lista las expulsiones', () => {
    const m = match(A, B, [1, 0], '2026-03-01T20:00:00Z');
    const f = matchFacts(m, [event(m, 'own_goal', A.id, p2.id, 30), event(m, 'red_card', B.id, p2.id, 70)], players);
    assert.deepEqual(f.scorers[0]!.minutes, ["30' (ag)"]);
    assert.equal(f.redCards[0]!.name, 'Beto');
  });
});

describe('fechas', () => {
  const day1 = [
    match(A, B, [3, 0], '2026-03-01T20:00:00Z', { round: 1 }),
    match(C, D, [2, 2], '2026-03-02T20:00:00Z', { round: 1 }),
  ];

  it('resume la fecha: mayor goleada y partido con más goles', () => {
    const [day] = matchdays(season(day1));
    const s = summarizeMatchday(day!);
    assert.equal(s.goals, 7);
    assert.equal(s.biggestWin?.homeScore, 3);
    assert.equal(s.highestScoring?.homeTeamId, C.id);
    assert.deepEqual([s.homeWins, s.draws, s.awayWins], [1, 1, 0]);
  });

  it('separa partidos reprogramados y da la fecha por completa sin ellos', () => {
    const late = match(A, C, null, '2026-04-20T20:00:00Z', { round: 2 });
    const data = season([
      ...day1,
      match(B, D, [1, 0], '2026-03-08T20:00:00Z', { round: 2 }),
      match(D, A, [0, 1], '2026-03-08T22:00:00Z', { round: 2 }),
      late,
    ]);
    const days = matchdays(data);
    const second = days.find((d) => d.round === 2)!;
    assert.deepEqual(second.rescheduled.map((m) => m.id), [late.id]);
    assert.equal(second.complete, true);
    assert.equal(lastCompletedMatchday(days)?.round, 2);
  });
});
