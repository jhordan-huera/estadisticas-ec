// Conversión de instantes UTC a la hora de Ecuador continental.
// Todas las fechas se guardan en UTC (ISO 8601) y solo se localizan al mostrarlas.

export const DEFAULT_TIME_ZONE = 'America/Guayaquil';

export interface LocalDateTime {
  /** AAAA-MM-DD en la zona local */
  date: string;
  /** HH:mm en 24 horas */
  time: string;
  /** "sábado" */
  weekday: string;
  /** "1 de noviembre" */
  dayMonth: string;
  /** "1 nov" */
  short: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('es-EC', {
      timeZone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function toLocal(isoUtc: string, timeZone = DEFAULT_TIME_ZONE): LocalDateTime {
  const instant = parseUtc(isoUtc);
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  const monthIndex = MONTHS.indexOf(String(parts.month).toLowerCase());
  const month = String(monthIndex + 1).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return {
    date: `${parts.year}-${month}-${day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: String(parts.weekday).toLowerCase(),
    dayMonth: `${Number(parts.day)} de ${String(parts.month).toLowerCase()}`,
    short: `${Number(parts.day)} ${String(parts.month).toLowerCase().slice(0, 3)}`,
  };
}

/** Acepta "2026-11-01T16:00Z", "2026-11-01T16:00:00Z" y "2026-11-01T16:00:00" (se asume UTC). */
export function parseUtc(iso: string): Date {
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha inválida: ${iso}`);
  return date;
}

/** Normaliza cualquier instante a ISO UTC con segundos: 2026-11-01T16:00:00Z */
export function toIsoUtc(iso: string): string {
  return parseUtc(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Fecha local (AAAA-MM-DD) de "ahora" en la zona indicada. */
export function localToday(now: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  return toLocal(now.toISOString(), timeZone).date;
}

/** Instante UTC (ISO) de una fecha y hora locales en la zona indicada: ("2026-11-07", "08:00"). */
export function localToUtc(date: string, time: string, timeZone = DEFAULT_TIME_ZONE): string {
  const wanted = Date.parse(`${date}T${time}:00Z`);
  let guess = wanted;
  // Dos ajustes bastan incluso con cambios de horario (Ecuador no tiene, pero la zona es configurable).
  for (let i = 0; i < 2; i++) {
    const local = toLocal(new Date(guess).toISOString(), timeZone);
    guess += wanted - Date.parse(`${local.date}T${local.time}:00Z`);
  }
  return new Date(guess).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Lleva un instante a la franja permitida [desde, hasta) en hora local: antes de "desde"
 * pasa a "desde" ese mismo día; desde "hasta" en adelante pasa a "desde" del día siguiente.
 */
export function withinLocalHours(isoUtc: string, from: string, to: string, timeZone = DEFAULT_TIME_ZONE): string {
  const local = toLocal(isoUtc, timeZone);
  if (local.time >= from && local.time < to) return isoUtc;
  if (local.time < from) return localToUtc(local.date, from, timeZone);
  const next = new Date(Date.parse(`${local.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return localToUtc(next, from, timeZone);
}
