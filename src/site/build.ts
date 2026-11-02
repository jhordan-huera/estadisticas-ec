// Panel web estático y de solo lectura: tabla, goleadores, resultados y próximos partidos.
// Se genera como HTML plano (sin JavaScript) más un datos.json con la misma información.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toLocal } from '../core/time.ts';
import { scorersView, standingsView, type ViewContext } from '../content/views.ts';
import type { TeamVisual } from '../design/components/team.ts';
import { palette } from '../design/tokens.ts';
import { lastCompletedMatchday, matchdays, nextMatchday, type Matchday } from '../stats/matchday.ts';
import type { StatMatch } from '../stats/types.ts';

export interface SiteOptions {
  outDir: string;
  brand: { name: string; handle: string; disclaimer: string };
  source: string;
  now: Date;
}

const esc = (v: unknown) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function buildSite(ctx: ViewContext, opts: SiteOptions): { files: string[] } {
  mkdirSync(opts.outDir, { recursive: true });
  const days = matchdays(ctx.data);
  const done = lastCompletedMatchday(days);
  const next = nextMatchday(days, opts.now);
  const standings = standingsView(ctx, done);
  const scorers = scorersView(ctx, 10);
  const updated = toLocal(opts.now.toISOString(), ctx.timeZone);
  const recent = recentResults(ctx, days, opts.now);

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.brand.name)} · ${esc(ctx.data.competitionName)} ${ctx.data.year}</title>
<meta name="description" content="Tabla, goleadores y resultados de la ${esc(ctx.data.competitionName)} ${ctx.data.year}. ${esc(opts.brand.disclaimer)}.">
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="brand"><span>${esc(opts.brand.name.split(' ')[0]!.toUpperCase())}</span><b>${esc(opts.brand.name.split(' ').slice(1).join(' ').toUpperCase())}</b></div>
  <div class="meta">${esc(ctx.data.competitionName)} ${ctx.data.year} · actualizado el ${esc(updated.dayMonth)}, ${esc(updated.time)} (hora de Ecuador)</div>
</header>
<nav class="jump"><a href="#tabla">Tabla</a><a href="#goleadores">Goleadores</a><a href="#resultados">Resultados</a><a href="#proximos">Próximos</a></nav>
<main>
  <section id="tabla">
    <h2>Tabla de posiciones</h2>
    <p class="kicker">${esc(standings.kicker)}</p>
    ${standings.tables.map((t) => standingsTable(t.label, t.rows, standings.tables.length > 1)).join('\n')}
  </section>
  <section id="goleadores">
    <h2>Goleadores</h2>
    <div class="scroll"><table>
      <thead><tr><th>#</th><th class="l">Jugador</th><th class="l">Equipo</th><th>Goles</th><th>Penal</th></tr></thead>
      <tbody>${scorers.rows.map((r) => `<tr><td>${r.position}</td><td class="l strong">${esc(r.name)}</td><td class="l">${badge(r.team)} ${esc(r.team.shortName)}</td><td class="strong">${r.goals}</td><td>${r.penalties}</td></tr>`).join('')}</tbody>
    </table></div>
    ${scorers.unattributedGoals ? `<p class="note">${scorers.unattributedGoals} gol(es) sin autor registrado en la fuente.</p>` : ''}
  </section>
  <section id="resultados">
    <h2>Resultados recientes</h2>
    ${recent.length ? recent.map((g) => matchList(ctx, g.title, g.matches)).join('') : '<p class="note">Sin resultados recientes.</p>'}
  </section>
  <section id="proximos">
    <h2>Próximos partidos</h2>
    ${next ? matchList(ctx, `${next.stageName} · ${next.label}`, next.matches.filter((m) => m.status !== 'finished')) : '<p class="note">No hay partidos programados.</p>'}
  </section>
</main>
<footer>
  <p><strong>${esc(opts.brand.disclaimer)}.</strong> Sitio no oficial; no usa marcas ni logos de la liga ni de los clubes.</p>
  <p>${esc(opts.source)} · Horarios en hora de Ecuador (UTC-5) · ${esc(opts.brand.handle)}</p>
</footer>
</body>
</html>
`;

  const data = {
    generadoEn: opts.now.toISOString(),
    competicion: ctx.data.competitionName,
    temporada: ctx.data.year,
    tablas: standings.tables.map((t) => ({
      nombre: t.label,
      filas: t.rows.map((r) => ({ pos: r.position, equipo: r.team.name, abrev: r.team.abbr, pj: r.played, g: r.won, e: r.drawn, p: r.lost, gf: r.goalsFor, gc: r.goalsAgainst, dg: r.goalDiff, pts: r.points })),
    })),
    goleadores: scorers.rows.map((r) => ({ pos: r.position, jugador: r.name, equipo: r.team.name, goles: r.goals, penales: r.penalties })),
    resultados: recent.flatMap((g) => g.matches.map((m) => matchJson(ctx, m))),
    proximos: next ? next.matches.filter((m) => m.status !== 'finished').map((m) => matchJson(ctx, m)) : [],
    aviso: opts.brand.disclaimer,
  };

  const files = [join(opts.outDir, 'index.html'), join(opts.outDir, 'datos.json')];
  writeFileSync(files[0]!, html);
  writeFileSync(files[1]!, JSON.stringify(data, null, 2) + '\n');
  writeFileSync(join(opts.outDir, '.nojekyll'), '');
  return { files };
}

function recentResults(ctx: ViewContext, days: Matchday[], now: Date): { title: string; matches: StatMatch[] }[] {
  const nowIso = now.toISOString();
  const withResults = days.filter((d) => d.matches.some((m) => m.status === 'finished' && m.kickoffUtc <= nowIso));
  return withResults.slice(-2).reverse().map((d) => ({ title: `${d.stageName} · ${d.label}`, matches: d.matches.filter((m) => m.status === 'finished') }));
}

function standingsTable(label: string, rows: ReturnType<typeof standingsView>['tables'][number]['rows'], showLabel: boolean): string {
  return `${showLabel ? `<h3>${esc(label)}</h3>` : ''}<div class="scroll"><table>
  <thead><tr><th>#</th><th class="l">Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th><th class="l">Últimos 5</th></tr></thead>
  <tbody>${rows
    .map(
      (r) =>
        `<tr${r.position === 1 ? ' class="lead"' : ''}><td>${r.position}</td><td class="l">${badge(r.team)} <span class="strong">${esc(r.team.shortName)}</span></td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${r.goalDiff > 0 ? '+' : ''}${r.goalDiff}</td><td class="strong">${r.points}</td><td class="l form">${r.form.map((o) => `<i class="${o}">${o === 'W' ? 'G' : o === 'D' ? 'E' : 'P'}</i>`).join('')}</td></tr>`,
    )
    .join('')}</tbody>
</table></div>`;
}

function matchList(ctx: ViewContext, title: string, matches: StatMatch[]): string {
  return `<h3>${esc(title)}</h3><ul class="matches">${matches
    .map((m) => {
      const home = ctx.visuals.get(m.homeTeamId)!;
      const away = ctx.visuals.get(m.awayTeamId)!;
      const local = toLocal(m.kickoffUtc, ctx.timeZone);
      const center = m.status === 'finished' ? `${m.homeScore} - ${m.awayScore}` : m.status === 'postponed' ? 'Aplazado' : local.time;
      return `<li><span class="when">${esc(local.weekday.slice(0, 3))} ${esc(local.short)}</span><span class="team h">${esc(home.shortName)} ${badge(home)}</span><span class="score">${esc(center)}</span><span class="team">${badge(away)} ${esc(away.shortName)}</span><span class="venue">${esc(m.venue ?? '')}</span></li>`;
    })
    .join('')}</ul>`;
}

function matchJson(ctx: ViewContext, m: StatMatch) {
  return {
    inicioUtc: m.kickoffUtc,
    local: ctx.visuals.get(m.homeTeamId)!.name,
    visitante: ctx.visuals.get(m.awayTeamId)!.name,
    golesLocal: m.homeScore,
    golesVisitante: m.awayScore,
    estado: m.status,
    estadio: m.venue,
  };
}

function badge(team: TeamVisual): string {
  return `<span class="badge" style="background:${esc(team.color)};color:${esc(team.textColor)}">${esc(team.abbr)}</span>`;
}

const CSS = `
:root{--win:${palette.win};--ink:${palette.ink};--raised:${palette.inkRaised};--high:${palette.inkHigh};--line:${palette.line};--paper:${palette.paper};--muted:${palette.muted};--accent:${palette.accent};--loss:${palette.loss}}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--paper);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.top{border-top:6px solid var(--accent);padding:24px 16px 8px;max-width:980px;margin:0 auto;display:flex;flex-wrap:wrap;gap:8px 24px;align-items:baseline;justify-content:space-between}
.brand{font-weight:800;letter-spacing:.04em;font-size:22px;display:flex;gap:8px;align-items:center}
.brand b{background:var(--accent);color:#fff;padding:0 8px;border-radius:5px}
.meta{color:var(--muted);font-size:14px}
.jump{max-width:980px;margin:0 auto;padding:8px 16px;display:flex;gap:16px;flex-wrap:wrap;font-size:14px}
.jump a{color:var(--accent);text-decoration:none;font-weight:600}
main{max-width:980px;margin:0 auto;padding:0 16px 32px}
section{margin-top:32px}
h2{font-size:28px;line-height:1.1;margin:0 0 4px;text-transform:uppercase;letter-spacing:.01em}
h3{font-size:15px;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;margin:20px 0 8px}
.kicker,.note{color:var(--muted);font-size:14px;margin:0 0 8px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--raised)}
table{border-collapse:collapse;width:100%;min-width:560px;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;text-align:center;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
tr:last-child td{border-bottom:0}
.l{text-align:left}.strong{font-weight:700}
tr.lead td{background:rgba(10,120,219,.08)}
.badge{display:inline-block;min-width:40px;padding:2px 6px;border-radius:6px;font-size:11px;font-weight:800;text-align:center;letter-spacing:.04em;vertical-align:middle}
.form i{display:inline-block;width:20px;height:20px;line-height:20px;margin-right:3px;border-radius:5px;font-style:normal;font-size:11px;font-weight:800;text-align:center;background:var(--high)}
.form i.W{background:var(--win);color:#fff}.form i.L{background:var(--loss);color:#fff}
.matches{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.matches li{display:grid;grid-template-columns:72px 1fr 72px 1fr;gap:8px;align-items:center;background:var(--raised);border:1px solid var(--line);border-radius:10px;padding:8px 12px}
.matches .when{color:var(--muted);font-size:13px}.matches .team{font-weight:600}.matches .team.h{text-align:right}
.matches .score{text-align:center;font-weight:800}
.matches .venue{grid-column:1/-1;color:var(--muted);font-size:12px;text-align:center}
footer{max-width:980px;margin:0 auto;padding:24px 16px 40px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
@media (max-width:560px){.matches li{grid-template-columns:1fr 64px 1fr}.matches .when{grid-column:1/-1}.badge{min-width:34px}}
`;
