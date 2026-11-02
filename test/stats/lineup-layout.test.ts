import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { depthOf, lateralOf, lineupRows } from '../../src/stats/lineup-layout.ts';

interface P {
  name: string;
  position: string | null;
  formationPlace: number | null;
}

const p = (name: string, position: string | null, formationPlace: number | null = null): P => ({ name, position, formationPlace });
const names = (rows: P[][]) => rows.map((r) => r.map((x) => x.name));

describe('ubicación de la alineación en la cancha', () => {
  it('ordena las posiciones de ESPN por profundidad y banda', () => {
    assert.equal(depthOf('G'), 0);
    assert.ok(depthOf('CD-L') < depthOf('LWB'));
    assert.ok(depthOf('DM') < depthOf('CM') && depthOf('CM') < depthOf('AM-R') && depthOf('AM-R') < depthOf('F'));
    assert.equal(depthOf(null), 3);
    assert.deepEqual(['LB', 'CD-L', 'CD', 'CD-R', 'RB'].map(lateralOf), [-2, -1, 0, 1, 2]);
  });

  it('reparte un 4-2-3-1 en filas, con el arquero primero y cada fila de izquierda a derecha', () => {
    const starters = [
      p('Delantero', 'F', 11),
      p('Lateral D', 'RB', 2),
      p('Arquero', 'G', 1),
      p('Volante I', 'DM-L', 6),
      p('Central I', 'CD-L', 5),
      p('Enganche', 'AM', 10),
      p('Volante D', 'DM-R', 8),
      p('Extremo I', 'LM', 7),
      p('Central D', 'CD-R', 4),
      p('Lateral I', 'LB', 3),
      p('Extremo D', 'RM', 9),
    ];
    assert.deepEqual(names(lineupRows('4-2-3-1', starters)), [
      ['Arquero'],
      ['Lateral I', 'Central I', 'Central D', 'Lateral D'],
      ['Volante I', 'Volante D'],
      ['Extremo I', 'Enganche', 'Extremo D'],
      ['Delantero'],
    ]);
  });

  it('sin formación válida agrupa por profundidad', () => {
    const starters = [p('Arquero', 'G'), p('Central', 'CD'), p('Lateral', 'LB'), p('Medio', 'CM'), p('Punta', 'F')];
    assert.deepEqual(names(lineupRows('4-4-2', starters)), [['Arquero'], ['Lateral', 'Central'], ['Medio'], ['Punta']]);
    assert.deepEqual(names(lineupRows(null, starters)), names(lineupRows('4-4-2', starters)));
  });

  it('si nadie figura como arquero, usa el lugar 1 del esquema', () => {
    const rows = lineupRows(null, [p('Otro', 'CM', 4), p('Uno', null, 1)]);
    assert.deepEqual(rows[0]?.map((x) => x.name), ['Uno']);
  });
});
