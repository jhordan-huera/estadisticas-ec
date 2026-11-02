// Banco de frases en español. Cada situación tiene varias variantes equivalentes;
// el redactor elige una de forma determinista. Variables entre llaves: {ganador}, …

export const RESULT_HEADLINES = {
  remontada: [
    '¡Remontada! {ganador} perdía {deficit} y terminó ganando {marcador} a {perdedor}{enCiudad}.',
    '{ganador} lo dio vuelta: estuvo abajo {deficit} y venció {marcador} a {perdedor}.',
    'Partido con vuelta: {ganador} se recuperó del golpe y le ganó {marcador} a {perdedor}.',
  ],
  goleada: [
    'Goleada de {ganador}: {marcador} a {perdedor}{enCiudad}.',
    '{ganador} pasó por encima de {perdedor} y ganó {marcador}.',
    'Contundente: {ganador} venció {marcador} a {perdedor}.',
    '{ganador} firmó un {marcador} ante {perdedor}{enCiudad}.',
  ],
  empate_sin_goles: [
    'Sin goles{enCiudad}: {local} y {visita} igualaron 0-0.',
    '{local} y {visita} no se sacaron diferencias: 0-0.',
    'Empate en blanco entre {local} y {visita}.',
  ],
  empate_rescatado: [
    '{rescatador} rescató el empate {marcador} ante {otro} después de ir abajo.',
    '{local} {marcador} {visita}: {rescatador} reaccionó a tiempo y se llevó un punto.',
  ],
  empate: [
    '{local} y {visita} empataron {marcador}{enCiudad}.',
    'Reparto de puntos: {local} {marcador} {visita}.',
    'Igualdad {marcador} entre {local} y {visita}.',
  ],
  victoria_ajustada: [
    '{ganador} venció {marcador} a {perdedor}{enCiudad}.',
    'Triunfo ajustado de {ganador}: {marcador} sobre {perdedor}.',
    '{ganador} se quedó con los tres puntos ante {perdedor} ({marcador}).',
  ],
  victoria_clara: [
    '{ganador} superó {marcador} a {perdedor}{enCiudad}.',
    'Victoria clara de {ganador}: {marcador} ante {perdedor}.',
    '{ganador} derrotó {marcador} a {perdedor} y suma de a tres.',
  ],
} as const;

export type ResultSituation = keyof typeof RESULT_HEADLINES;

export const RESULT_FACTS = {
  gol_al_final: ['{autor} lo definió en el {minuto}.', 'El gol del triunfo llegó en el {minuto}, obra de {autor}.'],
  lider_nuevo: ['{equipo} es el nuevo líder{deTabla}.', 'Cambio en la cima: {equipo} pasa al primer lugar{deTabla}.'],
  racha_victorias: ['{equipo} suma {n} victorias seguidas.', '{equipo} encadena {n} triunfos al hilo.'],
  racha_invicto: ['{equipo} lleva {n} partidos sin perder.', '{equipo} completa {n} partidos invicto.'],
  racha_derrotas: ['{equipo} acumula {n} derrotas consecutivas.', 'Mal momento para {equipo}: {n} derrotas seguidas.'],
  fin_racha_sin_ganar: ['{equipo} volvió a ganar después de {n} partidos.', '{equipo} cortó una racha de {n} partidos sin victorias.'],
  expulsados: ['Expulsado: {lista}.', 'Tarjeta roja para {lista}.'],
  expulsados_varios: ['Expulsados: {lista}.'],
  victoria_visitante: ['{equipo} ganó como visitante.', 'Tres puntos de visita para {equipo}.'],
} as const;

export type ResultFact = keyof typeof RESULT_FACTS;

export const FIXTURES_HEADLINES = [
  '🗓️ Así se juega la {fecha}.',
  '🗓️ Llega la {fecha}: estos son los partidos.',
  '🗓️ Cartelera de la {fecha}.',
] as const;

export const SUMMARY_HEADLINES = [
  'Así terminó la {fecha}: {goles} goles en {partidos} partidos.',
  'Cierre de la {fecha}: {goles} goles, {promedio} por partido.',
  'La {fecha} en números: {partidos} partidos y {goles} goles.',
] as const;

export const SUMMARY_NO_GOALS = ['La {fecha} terminó sin goles en sus {partidos} partidos.'] as const;

export const STANDINGS_HEADLINES = ['📊 Así está la tabla{contexto}.', '📊 Posiciones{contexto}.', '📊 La tabla, al día{contexto}.'] as const;

export const STANDINGS_LEADER = [
  '{tabla}: {lider} manda con {pts} puntos{ventaja}.',
  '{tabla}: {lider} es líder con {pts} puntos{ventaja}.',
] as const;

export const STANDINGS_NEW_LEADER = ['🔝 Nuevo líder en {tabla}: {lider}.', '🔝 {lider} toma la punta de {tabla}.'] as const;

export const SCORERS_HEADLINES = [
  '🎯 {lider} ({equipo}) lidera la tabla de goleadores con {n} goles.',
  '🎯 {lider} sigue arriba: {n} goles con {equipo}.',
  '🎯 Goleadores de la temporada: {lider} ({equipo}) manda con {n}.',
] as const;

export const SCORERS_SHARED = ['🎯 {lideres} comparten la cima de goleadores con {n} goles.'] as const;

export const TEAM_HEADLINES = ['🔎 Radiografía de {equipo} en la temporada.', '🔎 Los números de {equipo}.', '🔎 {equipo}, en datos.'] as const;

export const H2H_HEADLINES = ['👀 Previa: {local} vs {visita}.', '👀 Se viene {local} vs {visita}.', '👀 Cara a cara: {local} recibe a {visita}.'] as const;

export const H2H_FIRST_MEETING = ['Primer cruce entre ambos en la temporada.', 'Será su primer duelo del año.'] as const;
