// Planificador: decide qué publicar a partir del estado de los datos y de la hora.
// Es una función pura (sin base de datos ni red) para poder probarla con datos de ejemplo.
//
// Disparadores:
//   partido finalizado      → resultado
//   fecha completa          → resumen, goleadores (si cambiaron) y radiografía del equipo destacado
//   tabla cambiada          → tabla (una vez terminados los partidos del día)
//   nueva fecha por empezar → cartelera
//   partido en las próximas horas → previa con duelo directo

import type { PostKind, PublishingConfig } from '../core/config.ts';
import { sha256 } from '../core/text.ts';
import { localToday, localToUtc, toIsoUtc, toLocal, withinLocalHours } from '../core/time.ts';
import { scorersView, standingsView, type ViewContext } from '../content/views.ts';
import { matchdays, type Matchday } from '../stats/matchday.ts';
import { leagueMatches, seasonTables } from '../stats/season.ts';
import { teamProfile } from '../stats/team.ts';

export type Subject = { matchId: number } | { stageId: number; round: number } | { stageId: number; round: number; teamId: number } | Record<string, never>;

export interface Candidate {
  kind: PostKind;
  dedupeKey: string;
  competitionCode: string;
  season: number;
  subject: Subject;
  priority: number;
  scheduledFor: string;
  expiresAt: string | null;
  series?: string;
  fingerprint?: string;
  reason: string;
}

export const PRIORITY: Record<PostKind, number> = {
  resultado: 10,
  alineaciones: 12,
  cartelera: 15,
  resumen: 20,
  tabla: 30,
  duelo: 35,
  goleadores: 40,
  equipo: 60,
};

export interface PlannerInput {
  ctx: ViewContext;
  now: Date;
  kinds: Set<PostKind>;
  config: Pick<
    PublishingConfig,
    'ventanaDias' | 'anticipacionCarteleraHoras' | 'anticipacionPreviaHoras' | 'desde' | 'separacionPreviasMinutos' | 'horario' | 'cierreFecha'
  >;
  /** Huella del último contenido publicado por serie ("tabla:serie-a:2026" → huella). */
  snapshots: Map<string, string>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function planCandidates(input: PlannerInput): Candidate[] {
  const { ctx, now, kinds } = input;
  const code = ctx.data.competitionCode;
  const year = ctx.data.year;
  const nowIso = iso(now);
  // Inicio efectivo: lo más reciente entre la ventana de días y la fecha de arranque configurada.
  const byWindow = iso(new Date(now.getTime() - input.config.ventanaDias * DAY));
  const goLive = input.config.desde ? toIsoUtc(input.config.desde) : '';
  const windowStart = goLive > byWindow ? goLive : byWindow;
  const days = matchdays(ctx.data);
  const out: Candidate[] = [];
  const base = (kind: PostKind) => ({ kind, competitionCode: code, season: year, priority: PRIORITY[kind], scheduledFor: nowIso });

  // Partido finalizado → resultado
  if (kinds.has('resultado')) {
    for (const m of ctx.data.matches) {
      if (m.status !== 'finished' || m.kickoffUtc < windowStart || m.kickoffUtc > nowIso) continue;
      out.push({
        ...base('resultado'),
        dedupeKey: `resultado:${code}:${m.id}`,
        subject: { matchId: m.id },
        expiresAt: iso(new Date(Date.parse(m.kickoffUtc) + (input.config.ventanaDias + 1) * DAY)),
        reason: 'Partido finalizado',
      });
    }
  }

  // Fecha completa → resumen, goleadores y equipo destacado, escalonados tras el cierre:
  // el resultado y la tabla salen al momento; el resumen después, luego los goleadores y la
  // radiografía del equipo a la mañana siguiente. Las horas se fijan al encolar por primera vez.
  const delays = { ...DEFAULT_CLOSING_DELAYS, ...input.config.cierreFecha };
  const after = (minutes: number) => iso(new Date(now.getTime() + minutes * 60_000));
  const completed = days.filter((d) => d.complete && d.lastKickoff >= windowStart);
  for (const day of completed) {
    const subject = { stageId: day.stageId, round: day.round };
    const expiresAt = iso(new Date(Date.parse(day.lastKickoff) + (input.config.ventanaDias + 1) * DAY));
    if (kinds.has('resumen')) {
      out.push({ ...base('resumen'), scheduledFor: after(delays.resumenMinutos), dedupeKey: `resumen:${code}:${day.stageId}:${day.round}`, subject, expiresAt, reason: `${day.label} completa` });
    }
  }
  const latestDone = completed.at(-1);
  if (latestDone) {
    const subject = { stageId: latestDone.stageId, round: latestDone.round };
    const expiresAt = iso(new Date(Date.parse(latestDone.lastKickoff) + (input.config.ventanaDias + 1) * DAY));
    if (kinds.has('goleadores')) {
      const series = `goleadores:${code}:${year}`;
      const fingerprint = scorersView(ctx).fingerprint;
      if (fingerprint && input.snapshots.get(series) !== fingerprint) {
        out.push({
          ...base('goleadores'),
          scheduledFor: after(delays.goleadoresMinutos),
          dedupeKey: `goleadores:${code}:${latestDone.stageId}:${latestDone.round}`,
          subject,
          expiresAt,
          series,
          fingerprint,
          reason: 'Goleadores actualizados tras la fecha',
        });
      }
    }
    if (kinds.has('equipo')) {
      const teamId = featuredTeam(ctx);
      if (teamId !== undefined) {
        out.push({
          ...base('equipo'),
          scheduledFor: nextLocalTime(now, delays.equipoHora, ctx.timeZone),
          dedupeKey: `equipo:${code}:${latestDone.stageId}:${latestDone.round}`,
          subject: { ...subject, teamId },
          expiresAt,
          reason: `Racha destacada de ${ctx.data.teams.get(teamId)?.shortName ?? teamId}`,
        });
      }
    }
  }

  // Tabla cambiada → tabla, cuando ya no quedan partidos del día por jugarse
  if (kinds.has('tabla')) {
    const series = `tabla:${code}:${year}`;
    const view = standingsView(ctx, latestDone);
    const changed = view.fingerprint !== input.snapshots.get(series);
    const league = leagueMatches(ctx.data);
    const anyLive = league.some((m) => m.status === 'live');
    const today = localToday(now, ctx.timeZone);
    const laterToday = league.some((m) => m.status === 'scheduled' && m.kickoffUtc > nowIso && toLocal(m.kickoffUtc, ctx.timeZone).date === today);
    const anyPlayed = league.some((m) => m.status === 'finished');
    if (changed && anyPlayed && !anyLive && !laterToday) {
      out.push({
        ...base('tabla'),
        dedupeKey: `tabla:${code}:${year}:${sha256(view.fingerprint).slice(0, 12)}`,
        subject: {},
        expiresAt: iso(new Date(now.getTime() + 2 * DAY)),
        series,
        fingerprint: view.fingerprint,
        reason: 'La tabla cambió',
      });
    }
  }

  // Nueva fecha por empezar → cartelera
  if (kinds.has('cartelera')) {
    const upcoming = days.find((d) => !d.complete && d.firstKickoff > nowIso);
    if (upcoming && Date.parse(upcoming.firstKickoff) - now.getTime() <= input.config.anticipacionCarteleraHoras * HOUR) {
      out.push({
        ...base('cartelera'),
        dedupeKey: `cartelera:${code}:${upcoming.stageId}:${upcoming.round}`,
        subject: { stageId: upcoming.stageId, round: upcoming.round },
        expiresAt: upcoming.firstKickoff,
        reason: `${upcoming.label} empieza el ${toLocal(upcoming.firstKickoff, ctx.timeZone).dayMonth}`,
      });
    }
  }

  // Partido en las próximas horas → previa (escalonada si coinciden varias)
  if (kinds.has('duelo')) {
    const horizon = iso(new Date(now.getTime() + input.config.anticipacionPreviaHoras * HOUR));
    const slots = previewSlots(leagueMatches(ctx.data), nowIso, input.config, ctx.timeZone);
    for (const m of leagueMatches(ctx.data)) {
      if (m.status !== 'scheduled' || m.kickoffUtc <= nowIso || m.kickoffUtc > horizon) continue;
      const slot = slots.get(m.id);
      if (!slot) continue;
      out.push({ ...base('duelo'), scheduledFor: slot, dedupeKey: `duelo:${code}:${m.id}`, subject: { matchId: m.id }, expiresAt: m.kickoffUtc, reason: 'Partido en las próximas horas' });
    }
  }

  // Alineaciones confirmadas → en cuanto ambas están completas; ya no sirven a los 45' de juego.
  if (kinds.has('alineaciones')) {
    for (const m of leagueMatches(ctx.data)) {
      if (m.status !== 'scheduled' && m.status !== 'live') continue;
      const expiresAt = iso(new Date(Date.parse(m.kickoffUtc) + LINEUPS_VALID_MINUTES * 60_000));
      if (expiresAt <= nowIso || !hasCompleteLineups(ctx.data.lineups.get(m.id))) continue;
      out.push({ ...base('alineaciones'), dedupeKey: `alineaciones:${code}:${m.id}`, subject: { matchId: m.id }, expiresAt, reason: 'Alineaciones confirmadas' });
    }
  }

  // Horario de publicación: nada sale de madrugada salvo lo que es noticia del momento.
  const hours = { ...DEFAULT_HOURS, ...input.config.horario };
  for (const c of out) {
    if (c.kind === 'resultado' || c.kind === 'alineaciones' || c.kind === 'duelo') continue; // las previas ya vienen ajustadas
    c.scheduledFor = withinLocalHours(c.scheduledFor, hours.desde, hours.hasta, ctx.timeZone);
  }

  return out;
}

const DEFAULT_HOURS = { desde: '08:00', hasta: '23:00' };
const LINEUPS_VALID_MINUTES = 45;

function hasCompleteLineups(lineups: { players: { starter: boolean }[] }[] | undefined): boolean {
  return lineups?.length === 2 && lineups.every((l) => l.players.filter((p) => p.starter).length >= 11);
}
const DEFAULT_CLOSING_DELAYS = { resumenMinutos: 60, goleadoresMinutos: 120, equipoHora: '10:00' };

/** Próxima vez que el reloj local marque `time` (hoy si aún no pasó, si no mañana). */
function nextLocalTime(now: Date, time: string, timeZone: string): string {
  const local = toLocal(now.toISOString(), timeZone);
  if (local.time < time) return localToUtc(local.date, time, timeZone);
  const tomorrow = new Date(Date.parse(`${local.date}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
  return localToUtc(tomorrow, time, timeZone);
}
const DEFAULT_PREVIEW_GAP_MINUTES = 45;
/** Una previa debe salir al menos este tiempo antes del partido; si no cabe, no se publica. */
const MIN_PREVIEW_LEAD_MINUTES = 30;

/**
 * Hora de publicación de cada previa: "anticipacionPreviaHoras" antes del partido, dentro del
 * horario permitido y separada de la anterior por "separacionPreviasMinutos" (en orden de hora
 * de partido). Es determinista: cada ejecución calcula las mismas horas.
 */
export function previewSlots(
  matches: { id: number; kickoffUtc: string; status: string }[],
  nowIso: string,
  config: Pick<PublishingConfig, 'anticipacionPreviaHoras' | 'separacionPreviasMinutos' | 'horario'>,
  timeZone: string,
): Map<number, string> {
  const hours = { ...DEFAULT_HOURS, ...config.horario };
  const gap = (config.separacionPreviasMinutos ?? DEFAULT_PREVIEW_GAP_MINUTES) * 60_000;
  const upcoming = matches
    .filter((m) => m.status === 'scheduled' && m.kickoffUtc > nowIso)
    .sort((a, b) => (a.kickoffUtc < b.kickoffUtc ? -1 : a.kickoffUtc > b.kickoffUtc ? 1 : a.id - b.id));
  const slots = new Map<number, string>();
  let last = -Infinity;
  for (const m of upcoming) {
    const kickoff = Date.parse(m.kickoffUtc);
    const ideal = Date.parse(withinLocalHours(iso(new Date(kickoff - config.anticipacionPreviaHoras * HOUR)), hours.desde, hours.hasta, timeZone));
    const at = Math.max(ideal, last + gap);
    if (at > kickoff - MIN_PREVIEW_LEAD_MINUTES * 60_000) continue;
    slots.set(m.id, iso(new Date(at)));
    last = at;
  }
  return slots;
}

/** Equipo con la racha vigente más llamativa (o ninguno si no hay rachas notables). */
export function featuredTeam(ctx: ViewContext): number | undefined {
  const league = leagueMatches(ctx.data);
  const positions = new Map<number, number>();
  for (const t of seasonTables(ctx.data, ctx.rules).current) for (const r of t.rows) positions.set(r.teamId, r.position);
  let best: { teamId: number; score: number } | undefined;
  for (const teamId of positions.keys()) {
    const s = teamProfile(teamId, league).streaks;
    const score = Math.max(s.wins >= 3 ? s.wins * 3 : 0, s.unbeaten >= 5 ? s.unbeaten * 2 : 0, s.losses >= 3 ? s.losses * 2 : 0, s.winless >= 5 ? s.winless : 0);
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && (positions.get(teamId) ?? 99) < (positions.get(best.teamId) ?? 99))) best = { teamId, score };
  }
  return best?.teamId;
}

export function findMatchday(days: Matchday[], stageId: number, round: number): Matchday | undefined {
  return days.find((d) => d.stageId === stageId && d.round === round);
}

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
