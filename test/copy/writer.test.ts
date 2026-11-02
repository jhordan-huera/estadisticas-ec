import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lineupsView, resultView, standingsView } from '../../src/content/views.ts';
import { deriveHashtag, hashtagsFor } from '../../src/copy/hashtags.ts';
import { chooseStreak } from '../../src/copy/rules.ts';
import { fill, pick, stableHash } from '../../src/copy/variants.ts';
import { writeCaption, type CopyContext } from '../../src/copy/writer.ts';
import { A, B, C, D, ctxFor, event, match, player, season } from '../helpers.ts';

const hashtags = { base: ['#FutbolEcuatoriano'], equipos: true, maximo: 4 };

function copyCtx(data: ReturnType<typeof season>): CopyContext {
  return { view: ctxFor(data), config: { hashtags, fuente: 'Datos: prueba' }, disclaimer: 'No afiliados a la LigaPro ni a los clubes', teamOverrides: {} };
}

describe('variantes deterministas', () => {
  it('la misma semilla elige siempre la misma variante', () => {
    const options = ['a', 'b', 'c', 'd'];
    assert.equal(pick(options, 'resultado:42'), pick(options, 'resultado:42'));
    const picked = new Set(Array.from({ length: 40 }, (_, i) => pick(options, `resultado:${i}`)));
    assert.ok(picked.size > 1, 'semillas distintas deben repartir variantes');
    assert.equal(stableHash('marcador'), stableHash('marcador'));
  });

  it('una variable faltante es un error (nunca se publica un texto a medias)', () => {
    assert.throws(() => fill('{ganador} venció a {perdedor}', { ganador: 'A' }), /perdedor/);
  });

  it('corrige el doble punto de nombres abreviados', () => {
    assert.equal(fill('Previa: {x}.', { x: 'Técnico U.' }), 'Previa: Técnico U.');
  });
});

describe('reglas por situación', () => {
  it('goleada con texto y hashtags de ambos equipos', () => {
    const m = match(A, B, [4, 0], '2026-03-01T20:00:00Z');
    const data = season([m]);
    const caption = writeCaption(resultView(ctxFor(data), m), copyCtx(data));
    assert.match(caption.situation, /^goleada/);
    assert.match(caption.text, /4-0/);
    assert.ok(caption.hashtags.includes('#AtleticoAndino') && caption.hashtags.includes('#BarrioBravo'));
    assert.match(caption.text, /No afiliados a la LigaPro ni a los clubes/);
  });

  it('remontada, empate sin goles y victoria ajustada', () => {
    const p1 = player(1, 'Ana', A.id);
    const p2 = player(2, 'Beto', B.id);
    const comeback = match(A, B, [2, 1], '2026-03-01T20:00:00Z');
    const nil = match(C, D, [0, 0], '2026-03-01T22:00:00Z');
    const data = season([comeback, nil], {
      players: new Map([p1, p2].map((p) => [p.id, p])),
      events: [event(comeback, 'goal', B.id, 2, 10), event(comeback, 'goal', A.id, 1, 50), event(comeback, 'goal', A.id, 1, 70)],
    });
    assert.match(writeCaption(resultView(ctxFor(data), comeback), copyCtx(data)).situation, /^remontada/);
    assert.match(writeCaption(resultView(ctxFor(data), nil), copyCtx(data)).situation, /^empate_sin_goles/);
  });

  it('detecta líder nuevo tras el partido', () => {
    const first = match(A, B, [1, 0], '2026-03-01T20:00:00Z');
    const second = match(B, A, [3, 0], '2026-03-08T20:00:00Z');
    const data = season([first, second]);
    const caption = writeCaption(resultView(ctxFor(data), second), copyCtx(data));
    assert.match(caption.situation, /lider_nuevo/);
    assert.match(caption.text, /líder|primer lugar/);
  });

  it('elige la racha más relevante', () => {
    const s = (o: Partial<Record<'wins' | 'unbeaten' | 'losses' | 'winless', number>>) => ({ wins: 0, unbeaten: 0, losses: 0, winless: 0, draws: 0, cleanSheets: 0, scoring: 0, ...o });
    assert.equal(chooseStreak('A', s({}), s({ wins: 4, unbeaten: 4 }))[0]?.fact, 'racha_victorias');
    assert.equal(chooseStreak('A', s({ winless: 6 }), s({ wins: 1, unbeaten: 1 }))[0]?.fact, 'fin_racha_sin_ganar');
    assert.equal(chooseStreak('A', s({}), s({ losses: 3, winless: 3 }))[0]?.fact, 'racha_derrotas');
    assert.equal(chooseStreak('A', s({}), s({ wins: 1, unbeaten: 2 })).length, 0);
  });

  it('el texto de la tabla nombra al líder de cada tabla', () => {
    const data = season([match(A, B, [1, 0], '2026-03-01T20:00:00Z'), match(C, D, [0, 0], '2026-03-01T20:00:00Z')]);
    const caption = writeCaption(standingsView(ctxFor(data)), copyCtx(data));
    assert.match(caption.text, /Atlético Andino/);
  });
});

describe('hashtags', () => {
  it('derivan del nombre, sin tildes ni signos, sin duplicados y con máximo', () => {
    assert.equal(deriveHashtag('Liga de Quito'), '#LigaDeQuito');
    assert.equal(deriveHashtag('Técnico Universitario'), '#TecnicoUniversitario');
    const tags = hashtagsFor('tabla', [ctxFor(season([])).visuals.get(A.id)!, ctxFor(season([])).visuals.get(A.id)!], { ...hashtags, porTipo: { tabla: ['#Tabla', '#futbolecuatoriano'] } }, new Map());
    assert.deepEqual(tags, ['#FutbolEcuatoriano', '#Tabla', '#AtleticoAndino']);
  });
});

describe('alineaciones', () => {
  const xi = (teamId: number) => ({
    teamId,
    formation: '4-4-2',
    players: Array.from({ length: 11 }, (_, i) => ({ playerId: teamId * 100 + i, name: `Jugador${teamId}${i}`, jersey: String(i + 1), position: null, formationPlace: i + 1, starter: true })),
  });

  it('da la formación y el DT de cada equipo, sin repetir los onces de la imagen', () => {
    const m = match(A, B, null, '2026-08-01T20:00:00Z', { id: 41 });
    const data = season([m], { lineups: new Map([[41, [xi(A.id), xi(B.id)]]]) });
    const ctx = { ...copyCtx(data), teamOverrides: { 'espn:1': { abrev: A.abbr, dt: 'Ana Torres' } } };
    const caption = writeCaption(lineupsView(ctxFor(data), m), ctx);
    assert.match(caption.text, /Atlético Andino \(4-4-2\) · DT: Ana Torres/);
    assert.match(caption.text, /^Barrio Bravo \(4-4-2\)$/m);
    assert.doesNotMatch(caption.text, /Jugador/);
    // El DT que falta no se omite en silencio: queda como aviso.
    assert.deepEqual(caption.warnings, ['Falta el DT de Barrio Bravo (campo "dt" en config/equipos.json)']);
  });
});
