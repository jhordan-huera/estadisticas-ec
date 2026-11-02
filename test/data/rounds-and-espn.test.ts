import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapEspnLineups, mapEspnSeason, mapStatus, parseMinute } from '../../src/providers/espn/mapper.ts';
import type { EspnEvent, EspnSeasonType, EspnStandings, EspnSummary } from '../../src/providers/espn/raw.ts';
import { inferRounds, type RoundCandidate } from '../../src/sync/rounds.ts';

describe('inferencia de jornadas', () => {
  const m = (id: number, kickoffUtc: string, home: number, away: number): RoundCandidate => ({ id, kickoffUtc, homeTeamId: home, awayTeamId: away });

  it('asigna cada partido a la primera jornada libre de ambos equipos', () => {
    const { rounds } = inferRounds([
      m(1, '2026-03-01T20:00:00Z', 1, 2),
      m(2, '2026-03-01T22:00:00Z', 3, 4),
      m(3, '2026-03-08T20:00:00Z', 1, 3),
      m(4, '2026-03-08T22:00:00Z', 2, 4),
    ]);
    assert.deepEqual([...rounds.entries()].sort(), [
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 2],
    ]);
  });

  it('ubica un partido aplazado en su jornada original y lo marca como reprogramado', () => {
    const { rounds, outliers } = inferRounds([
      m(1, '2026-03-01T20:00:00Z', 1, 2),
      // 3-4 de la jornada 1 se aplazó y se juega después de la jornada 2
      m(3, '2026-03-08T20:00:00Z', 1, 3),
      m(4, '2026-03-08T22:00:00Z', 2, 4),
      m(2, '2026-03-25T20:00:00Z', 3, 4),
    ]);
    assert.equal(rounds.get(2), 1);
    assert.equal(rounds.get(3), 2);
    assert.deepEqual(outliers.map((o) => o.matchId), [2]);
  });

  it('respeta las correcciones manuales', () => {
    const { rounds } = inferRounds([m(1, '2026-03-01T20:00:00Z', 1, 2), m(2, '2026-03-08T20:00:00Z', 3, 4)], new Map([[2, 5]]));
    assert.equal(rounds.get(2), 5);
    assert.equal(rounds.get(1), 1);
  });
});

describe('traducción de ESPN', () => {
  const seasonTypes: EspnSeasonType[] = [
    { id: '1', type: 14082, name: 'Primera fase', startDate: '2026-01-01T05:00Z', endDate: '2026-09-15T03:59Z', hasGroups: false },
    { id: '2', type: 14081, name: 'Fase final', startDate: '2026-09-15T04:00Z', endDate: '2027-01-01T04:59Z', hasGroups: true },
  ];
  const standings: EspnStandings = {
    children: [
      { id: '1', name: 'Group 1', standings: { seasonType: 2, entries: [{ team: { id: '10', displayName: 'Uno' }, stats: [{ name: 'points', value: 9 }] }, { team: { id: '20', displayName: 'Dos' }, stats: [] }] } },
    ],
  };
  const team = (id: string, name: string) => ({ id, abbreviation: name.slice(0, 3).toUpperCase(), displayName: name, shortDisplayName: name, color: 'ff0000' });
  const event = (id: string, date: string, slug: string, type: number): EspnEvent => ({
    id,
    date,
    name: 'Dos at Uno',
    season: { year: 2026, type, slug },
    status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
    competitions: [
      {
        id,
        venue: { fullName: 'Estadio Prueba', address: { city: 'Quito' } },
        competitors: [
          { id: '10', homeAway: 'home', score: '2', team: team('10', 'Uno') },
          { id: '20', homeAway: 'away', score: '1', team: team('20', 'Dos') },
        ],
        details: [
          { type: { id: '70', text: 'Goal' }, clock: { displayValue: "45'+2'" }, team: { id: '10' }, scoringPlay: true, penaltyKick: true, athletesInvolved: [{ id: 'p1', displayName: 'Jugador Uno' }] },
          { type: { id: '70', text: 'Goal' }, clock: { displayValue: "60'" }, team: { id: '10' }, scoringPlay: true, ownGoal: true, athletesInvolved: [{ id: 'p2', displayName: 'Jugador Dos', team: { id: '20' } }] },
          { type: { id: '70', text: 'Goal' }, clock: { displayValue: "70'" }, team: { id: '20' }, scoringPlay: true, athletesInvolved: [{ id: 'p2', displayName: 'Jugador Dos' }] },
          { type: { id: '93', text: 'Red Card' }, clock: { displayValue: "80'" }, team: { id: '20' }, redCard: true, athletesInvolved: [] },
        ],
      },
    ],
  });

  it('corrige la fase por fecha cuando la etiqueta de ESPN es errónea y toma el grupo de la tabla', () => {
    // Partido de octubre que ESPN etiqueta como "first-stage" (defecto real observado).
    const out = mapEspnSeason({ seasonTypes, standings, events: [event('900', '2026-10-10T16:30Z', 'first-stage', 14082)], season: 2026 });
    const match = out.matches[0]!;
    assert.equal(match.stageExternalId, '2');
    assert.equal(match.groupExternalId, '1');
    assert.ok(out.issues.some((i) => i.code === 'ESPN_STAGE_LABEL_CORRECTED'));
    assert.equal(out.stages[1]!.kind, 'groups');
  });

  it('traduce goles de penal, autogoles y expulsiones con su minuto', () => {
    const { matches } = mapEspnSeason({ seasonTypes, standings, events: [event('901', '2026-03-01T20:00Z', 'first-stage', 14082)], season: 2026 });
    const kinds = matches[0]!.events.map((e) => [e.kind, e.minuteLabel, e.teamExternalId]);
    assert.deepEqual(kinds, [
      ['penalty_goal', "45+2'", '10'],
      ['own_goal', "60'", '10'],
      ['goal', "70'", '20'],
      ['red_card', "80'", '20'],
    ]);
    assert.equal(matches[0]!.city, 'Quito');
  });

  it('excluye partidos de otra temporada dejando constancia', () => {
    const e = event('902', '2026-03-01T20:00Z', 'first-stage', 14082);
    e.season!.year = 2025;
    const out = mapEspnSeason({ seasonTypes, standings, events: [e], season: 2026 });
    assert.equal(out.matches.length, 0);
    assert.ok(out.issues.some((i) => i.code === 'ESPN_EVENT_OTHER_SEASON'));
  });

  it('interpreta minutos y estados', () => {
    assert.deepEqual(parseMinute("90'+7'", undefined), { minute: 90, addedTime: 7, label: "90+7'" });
    assert.deepEqual(parseMinute(undefined, 1614), { minute: 27, addedTime: null, label: "27'" });
    const issues: never[] = [];
    assert.equal(mapStatus({ type: { name: 'STATUS_POSTPONED', state: 'pre', completed: false } }, 'x', issues).status, 'postponed');
    assert.equal(mapStatus({ type: { name: 'STATUS_SECOND_HALF', state: 'in', completed: false } }, 'x', issues).status, 'live');
    assert.deepEqual(mapStatus({ type: { name: 'STATUS_FINAL_PEN', state: 'post', completed: true } }, 'x', issues), { status: 'finished', decidedBy: 'penalties' });
  });
});

describe('alineaciones de ESPN', () => {
  it('traduce titulares, suplentes y la camiseta del partido', () => {
    const summary: EspnSummary = {
      rosters: [
        {
          homeAway: 'home',
          formation: ' 4-4-2 ',
          team: { id: '10' },
          uniform: { type: 'home', color: 'D10C29', alternateColor: 'f8f8ff' },
          roster: [
            { starter: true, jersey: '1', formationPlace: '1', position: { abbreviation: 'G' }, athlete: { id: 'a1', displayName: 'Juan Pérez', lastName: 'Pérez' } },
            { starter: false, jersey: '22', formationPlace: '0', position: { abbreviation: 'SUB' }, athlete: { id: 'a2', displayName: 'Luis Mora', shortName: 'L. Mora' } },
          ],
        },
        { homeAway: 'away', team: { id: '20' }, roster: [] },
      ],
    };
    assert.deepEqual(mapEspnLineups(summary), [
      {
        teamExternalId: '10',
        formation: '4-4-2',
        kit: { color: '#d10c29', detail: '#f8f8ff' },
        players: [
          { externalId: 'a1', name: 'Juan Pérez', shortName: 'Pérez', jersey: '1', position: 'G', formationPlace: 1, starter: true },
          { externalId: 'a2', name: 'Luis Mora', shortName: 'L. Mora', jersey: '22', position: 'SUB', formationPlace: null, starter: false },
        ],
      },
    ]);
  });

  it('sin alineaciones publicadas devuelve una lista vacía', () => {
    assert.deepEqual(mapEspnLineups({}), []);
  });
});
