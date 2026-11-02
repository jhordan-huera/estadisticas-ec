// Comandos de consulta del motor de estadísticas (salida de texto para revisar datos).

import type { AppContext } from '../app.ts';
import { toLocal } from '../core/time.ts';
import { headToHead } from '../stats/head-to-head.ts';
import { loadSeason } from '../stats/load.ts';
import { matchFacts } from '../stats/match-facts.ts';
import { lastCompletedMatchday, matchdays, summarizeMatchday } from '../stats/matchday.ts';
import { computeScorers, topScorers } from '../stats/scorers.ts';
import { leagueMatches, seasonTables, tableMovement } from '../stats/season.ts';
import { teamProfile } from '../stats/team.ts';
import type { SeasonData, StatMatch } from '../stats/types.ts';
import { recordVerification, tableRulesFor, verifyAgainstProvider } from '../stats/verify.ts';
import { flagInt, flagString, type ParsedArgs } from './args.ts';

const out = (line = '') => process.stdout.write(line + '\n');

function season(app: AppContext, args: ParsedArgs): SeasonData {
  return loadSeason(app.db, flagString(args, 'competicion') ?? 'serie-a', flagInt(args, 'temporada') ?? app.config.file.temporada);
}

function findTeam(data: SeasonData, abbr: string | undefined): number {
  if (!abbr) throw new Error('Indica el equipo por su abreviatura (p. ej. --equipo LDU)');
  const team = [...data.teams.values()].find((t) => t.abbr.toUpperCase() === abbr.toUpperCase());
  if (!team) throw new Error(`No existe un equipo con abreviatura ${abbr}`);
  return team.id;
}

function line(data: SeasonData, m: StatMatch): string {
  const h = data.teams.get(m.homeTeamId)!.shortName;
  const a = data.teams.get(m.awayTeamId)!.shortName;
  const score = m.homeScore !== null && m.status === 'finished' ? `${m.homeScore}-${m.awayScore}` : 'vs';
  return `${h} ${score} ${a}`;
}

export const statsCommands = {
  tabla: (app: AppContext, args: ParsedArgs) => {
    const data = season(app, args);
    const rules = tableRulesFor(app.config, data.competitionCode);
    const tables = seasonTables(data, rules);
    const last = lastCompletedMatchday(matchdays(data));
    const movement = last ? tableMovement(data, rules, last.firstKickoff) : new Map<number, number>();
    const list = args.flags.general ? [{ label: 'Tabla general', rows: tables.overall }] : tables.current;
    for (const t of list) {
      out(`\n${data.competitionName} ${data.year} · ${t.label} (puntos ${rules.puntosFaseFinal})`);
      out('  #  Equipo            PJ  G  E  P  GF GC  DG  Pts  Últimos 5  Mov.');
      for (const r of t.rows) {
        const team = data.teams.get(r.teamId)!;
        const mv = movement.get(r.teamId) ?? 0;
        out(
          `${String(r.position).padStart(3)}  ${team.shortName.padEnd(16)} ${String(r.played).padStart(3)}${String(r.won).padStart(3)}${String(r.drawn).padStart(3)}${String(r.lost).padStart(3)}${String(r.goalsFor).padStart(4)}${String(r.goalsAgainst).padStart(3)}${String(r.goalDiff > 0 ? '+' + r.goalDiff : r.goalDiff).padStart(4)}${String(r.points).padStart(5)}  ${r.form.join('').padEnd(9)}  ${mv > 0 ? '▲' + mv : mv < 0 ? '▼' + -mv : '='}`,
        );
      }
    }
    return 0;
  },

  goleadores: (app: AppContext, args: ParsedArgs) => {
    const data = season(app, args);
    const table = computeScorers(data.matches, data.events, data.players);
    const { rows, tiedOutside } = topScorers(table, flagInt(args, 'top') ?? 10);
    out(`\n${data.competitionName} ${data.year} · Goleadores`);
    for (const r of rows) {
      out(`${String(r.position).padStart(3)}  ${r.name.padEnd(26)} ${data.teams.get(r.teamId)!.abbr.padEnd(4)} ${String(r.goals).padStart(3)} goles  (${r.penalties} de penal, marcó en ${r.matchesWithGoal} partidos)`);
    }
    if (tiedOutside) out(`     … y ${tiedOutside} jugador(es) más con ${rows.at(-1)!.goals} goles`);
    out(`Autogoles: ${table.ownGoals} · Goles sin autor registrado: ${table.unattributedGoals}`);
    return 0;
  },

  equipo: (app: AppContext, args: ParsedArgs) => {
    const data = season(app, args);
    const teamId = findTeam(data, flagString(args, 'equipo'));
    const team = data.teams.get(teamId)!;
    const p = teamProfile(teamId, leagueMatches(data));
    const fmt = (s: typeof p.total) => `PJ ${s.played} · G ${s.won} E ${s.drawn} P ${s.lost} · GF ${s.goalsFor} GC ${s.goalsAgainst} · ${s.points} pts · vallas invictas ${s.cleanSheets}`;
    out(`\n${team.name} · ${data.competitionName} ${data.year}`);
    out(`  Total:     ${fmt(p.total)}`);
    out(`  Local:     ${fmt(p.home)}`);
    out(`  Visitante: ${fmt(p.away)}`);
    out(`  Últimos 5: ${p.last5.map((e) => `${e.outcome} ${e.goalsFor}-${e.goalsAgainst} ${e.home ? 'vs' : 'en'} ${data.teams.get(e.opponentId)!.abbr}`).join(' · ')}`);
    out(`  Rachas vigentes: ${JSON.stringify(p.streaks)}`);
    if (p.biggestWin) out(`  Mayor victoria: ${p.biggestWin.goalsFor}-${p.biggestWin.goalsAgainst} ante ${data.teams.get(p.biggestWin.opponentId)!.shortName}`);
    return 0;
  },

  duelo: (app: AppContext, args: ParsedArgs) => {
    const data = season(app, args);
    const a = findTeam(data, flagString(args, 'local'));
    const b = findTeam(data, flagString(args, 'visita'));
    const h = headToHead(a, b, data.matches);
    out(`\n${data.teams.get(a)!.shortName} vs ${data.teams.get(b)!.shortName} · ${data.competitionName} ${data.year}`);
    for (const m of h.played) out(`  ${toLocal(m.kickoffUtc).date}  ${line(data, m)}`);
    out(`  Balance: ${h.winsA} victorias ${data.teams.get(a)!.abbr} · ${h.draws} empates · ${h.winsB} victorias ${data.teams.get(b)!.abbr} · goles ${h.goalsA}-${h.goalsB}`);
    if (h.next) out(`  Próximo: ${toLocal(h.next.kickoffUtc).date} ${toLocal(h.next.kickoffUtc).time} ${line(data, h.next)}`);
    return 0;
  },

  resumen: (app: AppContext, args: ParsedArgs) => {
    const data = season(app, args);
    const days = matchdays(data);
    const stageOrd = flagInt(args, 'fase');
    const number = flagInt(args, 'numero');
    const day = number !== undefined ? days.find((d) => d.round === number && d.stageOrder === (stageOrd ?? 1)) : lastCompletedMatchday(days);
    if (!day) throw new Error('Fecha no encontrada');
    const s = summarizeMatchday(day);
    out(`\n${data.competitionName} · ${day.stageName} · ${day.label} ${day.complete ? '(completa)' : `(${day.finishedCount}/${day.matches.length} jugados)`}`);
    for (const m of day.matches) {
      const f = matchFacts(m, data.events, data.players);
      const tags = [f.isRout && 'goleada', f.comeback && `remontada de ${data.teams.get(f.comeback.teamId)!.abbr}`, f.isGoallessDraw && '0-0', f.lateWinner && `gol decisivo ${f.lateWinner.minuteLabel}`]
        .filter(Boolean)
        .join(', ');
      const pending = day.rescheduled.includes(m) ? ' [reprogramado]' : '';
      out(`  ${line(data, m).padEnd(36)} ${tags}${pending}`);
      for (const sc of f.scorers) out(`        ⚽ ${data.teams.get(sc.teamId)!.abbr} ${sc.name} ${sc.minutes.join(', ')}`);
      for (const rc of f.redCards) out(`        🟥 ${data.teams.get(rc.teamId)!.abbr} ${rc.name} ${rc.minute}`);
    }
    out(`  Goles: ${s.goals} (promedio ${s.averageGoals}) · local ${s.homeWins} · empates ${s.draws} · visita ${s.awayWins}`);
    if (s.biggestWin) out(`  Mayor goleada: ${line(data, s.biggestWin)}`);
    if (s.highestScoring) out(`  Partido con más goles: ${line(data, s.highestScoring)}`);
    return 0;
  },

  verificar: (app: AppContext, args: ParsedArgs) => {
    const data = season(app, args);
    const result = verifyAgainstProvider(app.db, data, tableRulesFor(app.config, data.competitionCode));
    const resolved = recordVerification(app.db, data, result);
    out(`Comparados ${result.compared} equipos con la tabla del proveedor: ${result.mismatches.length} diferencias (${resolved} resueltas)`);
    for (const m of result.mismatches) out(`  ${m.message}`);
    return result.mismatches.length ? 1 : 0;
  },
};
