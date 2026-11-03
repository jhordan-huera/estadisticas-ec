// CLI de Datazo EC. Uso: node src/cli/main.ts <comando> [opciones]

import { createApp, type AppContext } from '../app.ts';
import { describeError } from '../core/errors.ts';
import { sha256 } from '../core/text.ts';
import { toLocal } from '../core/time.ts';
import { many } from '../db/connection.ts';
import { CompetitionsRepo } from '../db/repositories/competitions.ts';
import { IssuesRepo } from '../db/repositories/issues.ts';
import { syncCompetitions } from '../sync/run.ts';
import { flagInt, flagString, parseArgs, type ParsedArgs } from './args.ts';
import { pipelineCommands } from './pipeline-commands.ts';
import { renderCommands } from './render-commands.ts';
import { statsCommands } from './stats-commands.ts';

const out = (line = '') => process.stdout.write(line + '\n');

const HELP = `Datazo EC — comandos:
  migrar                         Aplica las migraciones pendientes de la base de datos
  sincronizar [--competicion c]  Descarga y guarda los datos (todas las competiciones por defecto)
              [--temporada AAAA] [--cada MIN]  (--cada: omite si ya se sincronizó con éxito hace menos de MIN minutos)
  estado      [--temporada AAAA] Resumen de lo guardado por competición y fase
  fecha       --numero N         Partidos de una fecha (jornada)
              [--fase 1] [--competicion serie-a]
  incidencias [--nivel info|warning|error] [--detalle]  Anomalías de datos abiertas
  huella                         Huella del estado relevante (para no subir la rama "estado" sin cambios)

Estadísticas (opcional: --competicion serie-a --temporada AAAA):
  tabla       [--general]        Tabla vigente (grupos o general)
  goleadores  [--top 10]         Tabla de goleadores
  equipo      --equipo LDU       Perfil del equipo: local/visita, rachas, vallas invictas
  duelo       --local LDU --visita IDV   Historial de la temporada entre dos equipos
  resumen     [--fase 2 --numero 5]      Resumen de una fecha (por defecto la última completa)
  verificar                      Contrasta nuestra tabla con la del proveedor

Diseño:
  muestras    [--formato vertical|cuadrado] [--equipo LDU] [--logos]  Genera las 8 piezas con datos reales en out/muestras
  sitio       [--salida out/sitio]  Genera el panel web estático (index.html + datos.json)

Publicación (opcional: --ahora 2026-11-02T22:00:00Z para simular la hora):
  planificar                     Decide qué publicar y lo encola (sin duplicados)
  generar                        Dibuja imagen y texto de lo pendiente
  publicar                       Publica lo generado (simulación salvo DRY_RUN=false)
  ciclo                          sincronizar + planificar + generar + publicar
  cola        [--todas]          Estado de la cola de publicaciones
  alineaciones [--partido ID]    Consulta y guarda alineaciones (por defecto, partidos de las próximas horas)
  diagnostico                    Revisa las credenciales de Instagram (no publica nada)
  avisos-prueba                  Envía un aviso de prueba por ntfy y/o Telegram
  limpiar     [--dias 30]        Borra imágenes antiguas de la carpeta de publicaciones
`;

type Command = (app: AppContext, args: ParsedArgs) => Promise<number> | number;

const commands: Record<string, Command> = {
  ...statsCommands,
  ...renderCommands,
  ...pipelineCommands,
  migrar: () => {
    out('Base de datos al día.');
    return 0;
  },

  sincronizar: async (app, args) => {
    const code = flagString(args, 'competicion');
    const every = flagInt(args, 'cada');
    const season = flagInt(args, 'temporada') ?? app.config.file.temporada;
    if (every !== undefined) {
      const codes = code ? [code] : Object.keys(app.config.file.competiciones);
      const recent = codes.every((c) => {
        const last = many<{ finished_at: string }>(
          app.db,
          `SELECT finished_at FROM sync_runs WHERE job = :job AND ok = 1 ORDER BY finished_at DESC LIMIT 1`,
          { job: `sincronizar:${c}:${season}` },
        )[0];
        return last !== undefined && Date.now() - Date.parse(last.finished_at) < every * 60_000;
      });
      if (recent) {
        out(`Sin sincronizar ${codes.join(', ')}: la última sincronización correcta tiene menos de ${every} minutos.`);
        return 0;
      }
    }
    const outcomes = await syncCompetitions(app, { codes: code ? [code] : undefined, season });
    out('');
    for (const o of outcomes) {
      if (!o.ok || !o.summary) {
        out(`✗ ${o.code}: ${o.error}`);
        continue;
      }
      const s = o.summary;
      out(`✓ ${o.code} ${s.season}: ${s.matches.total} partidos (nuevos ${s.matches.inserted}, actualizados ${s.matches.updated}, sin cambios ${s.matches.unchanged}, recién finalizados ${s.matches.finishedNow})`);
      out(`    eventos: ${s.events} · incidencias: ${s.issues.error} errores, ${s.issues.warning} avisos, ${s.issues.info} informativas · resueltas: ${s.resolvedIssues}`);
      for (const r of s.rounds) out(`    ${r.stage}: ${r.rounds} fechas`);
    }
    out(`Peticiones HTTP: ${JSON.stringify(app.providers().requestCounts())}`);
    return outcomes.every((o) => o.ok) ? 0 : 1;
  },

  estado: (app, args) => {
    const year = flagInt(args, 'temporada') ?? app.config.file.temporada;
    const rows = many<{ code: string; stage: string; kind: string; status: string; n: number; rounds: number | null }>(
      app.db,
      `SELECT c.code, st.name AS stage, st.kind, m.status, COUNT(*) AS n, MAX(m.round) AS rounds
       FROM matches m JOIN stages st ON st.id = m.stage_id JOIN seasons se ON se.id = st.season_id
       JOIN competitions c ON c.id = se.competition_id
       WHERE se.year = :y GROUP BY c.code, st.ord, m.status ORDER BY c.code, st.ord, m.status`,
      { y: year },
    );
    if (rows.length === 0) {
      out(`No hay datos para ${year}. Ejecuta: npm run sincronizar`);
      return 0;
    }
    let current = '';
    for (const r of rows) {
      const key = `${r.code} · ${r.stage}`;
      if (key !== current) {
        out(`\n${key} (${r.kind})`);
        current = key;
      }
      out(`  ${r.status.padEnd(10)} ${String(r.n).padStart(4)}   fechas hasta ${r.rounds ?? '—'}`);
    }
    const teams = many<{ n: number }>(app.db, 'SELECT COUNT(*) AS n FROM teams')[0]!.n;
    const players = many<{ n: number }>(app.db, 'SELECT COUNT(*) AS n FROM players')[0]!.n;
    const lastRuns = many<{ job: string; finished_at: string; ok: number }>(
      app.db,
      'SELECT job, MAX(finished_at) AS finished_at, ok FROM sync_runs WHERE finished_at IS NOT NULL GROUP BY job ORDER BY job',
    );
    out(`\nEquipos: ${teams} · Jugadores: ${players}`);
    for (const r of lastRuns) out(`Última sincronización ${r.job}: ${r.finished_at} ${r.ok ? '✓' : '✗'}`);
    return 0;
  },

  fecha: (app, args) => {
    const code = flagString(args, 'competicion') ?? 'serie-a';
    const number = flagInt(args, 'numero');
    if (number === undefined) throw new Error('Falta --numero');
    const year = flagInt(args, 'temporada') ?? app.config.file.temporada;
    const season = new CompetitionsRepo(app.db).findSeason(code, year);
    if (!season) throw new Error(`Sin datos de ${code} ${year}`);
    const stages = new CompetitionsRepo(app.db).stages(season.seasonId);
    const stageOrd = flagInt(args, 'fase') ?? 1;
    const stage = stages.find((s) => s.ord === stageOrd);
    if (!stage) throw new Error(`La fase ${stageOrd} no existe (hay ${stages.length})`);
    const rows = many<{ kickoff_utc: string; home: string; away: string; hs: number | null; as: number | null; status: string; venue: string | null; grp: string | null; round_source: string }>(
      app.db,
      `SELECT m.kickoff_utc, h.short_name AS home, a.short_name AS away, m.home_score AS hs, m.away_score AS "as",
              m.status, m.venue, g.name AS grp, m.round_source
       FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
       LEFT JOIN stage_groups g ON g.id = m.group_id
       WHERE m.stage_id = :s AND m.round = :r ORDER BY g.external_id, m.kickoff_utc`,
      { s: stage.id, r: number },
    );
    out(`${season.competitionName} ${year} · ${stage.name} · Fecha ${number} (${rows.length} partidos, hora de Ecuador)`);
    for (const r of rows) {
      const t = toLocal(r.kickoff_utc, app.config.file.zonaHoraria);
      const score = r.hs !== null ? `${r.hs}-${r.as}` : 'vs';
      out(`  ${t.weekday.slice(0, 3)} ${t.date} ${t.time}  ${r.home.padStart(16)} ${score.padEnd(5)} ${r.away.padEnd(16)} ${r.status.padEnd(9)} ${r.grp ?? ''}  ${r.venue ?? ''}`);
    }
    return 0;
  },

  // Huella del estado relevante (cola, huellas publicadas, partidos, incidencias abiertas),
  // sin marcas de tiempo de cada ejecución: si no cambia, no hace falta subir la rama "estado".
  huella: (app) => {
    const parts = [
      many<{ v: string }>(app.db, `SELECT id || ':' || status || ':' || attempts || ':' || COALESCE(external_id, '') || ':' || COALESCE(mode, '') AS v FROM posts ORDER BY id`),
      many<{ v: string }>(app.db, `SELECT series || ':' || fingerprint AS v FROM content_snapshots ORDER BY series`),
      many<{ v: string }>(app.db, `SELECT provider || ':' || external_id || ':' || content_hash || ':' || COALESCE(round, '') || ':' || COALESCE(group_id, '') AS v FROM matches ORDER BY provider, external_id`),
      many<{ v: string }>(app.db, `SELECT source || ':' || code || ':' || entity_ref || ':' || (resolved_at IS NULL) AS v FROM data_issues ORDER BY source, code, entity_ref`),
      many<{ v: string }>(app.db, `SELECT match_id || ':' || team_id || ':' || COALESCE(formation, '') AS v FROM match_lineups ORDER BY match_id, team_id`),
      many<{ v: string }>(app.db, `SELECT match_id || ':' || COALESCE(outcome, '') AS v FROM lineup_watch ORDER BY match_id`),
      // Hora (no minuto) de la última sincronización correcta: conserva el control de "--cada"
      // sin obligar a subir la rama en cada ejecución.
      many<{ v: string }>(app.db, `SELECT job || ':' || substr(MAX(finished_at), 1, 13) AS v FROM sync_runs WHERE ok = 1 GROUP BY job ORDER BY job`),
    ];
    out(sha256(parts.map((rows) => rows.map((r) => r.v).join('|')).join('#')));
    return 0;
  },

  incidencias: (app, args) => {
    const level = (flagString(args, 'nivel') ?? 'info') as 'info' | 'warning' | 'error';
    const issues = new IssuesRepo(app.db).open(level);
    const byCode = new Map<string, number>();
    for (const i of issues) byCode.set(`${i.severity} ${i.source} ${i.code}`, (byCode.get(`${i.severity} ${i.source} ${i.code}`) ?? 0) + 1);
    out(`Incidencias abiertas (${issues.length}):`);
    for (const [k, n] of byCode) out(`  ${String(n).padStart(4)} × ${k}`);
    if (args.flags.detalle) for (const i of issues) out(`  [${i.severity}] ${i.code} ${i.entity_ref}: ${i.message}`);
    return 0;
  },
};

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === 'ayuda' || args.flags.help) {
    out(HELP);
    return 0;
  }
  const command = commands[args.command];
  if (!command) {
    out(`Comando desconocido: ${args.command}\n\n${HELP}`);
    return 2;
  }
  const app = createApp();
  try {
    return await command(app, args);
  } finally {
    app.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`Error: ${describeError(err)}\n`);
    process.exit(1);
  },
);
