// Piezas de datos: chips, puntos de forma, barras de estadística y cifras destacadas.

import type { Outcome } from '../../stats/types.ts';
import { withAlpha } from '../color.ts';
import { h, line, type VNode } from '../h.ts';
import { fonts, palette, radius, type } from '../tokens.ts';

export type Tone = 'accent' | 'muted' | 'loss' | 'outline';

export function chip(text: string, tone: Tone = 'muted', size: number = type.small): VNode {
  const styles: Record<Tone, { bg: string; fg: string; border: string }> = {
    accent: { bg: palette.accent, fg: palette.onAccent, border: palette.accent },
    muted: { bg: palette.inkHigh, fg: palette.paper, border: palette.inkHigh },
    loss: { bg: withAlpha(palette.loss, 0.16), fg: palette.loss, border: withAlpha(palette.loss, 0.5) },
    outline: { bg: 'transparent', fg: palette.muted, border: palette.line },
  };
  const s = styles[tone];
  return h(
    'div',
    {
      backgroundColor: s.bg,
      color: s.fg,
      border: `2px solid ${s.border}`,
      borderRadius: 999,
      padding: `${Math.round(size * 0.18)}px ${Math.round(size * 0.6)}px`,
      fontFamily: fonts.display,
      fontWeight: 700,
      fontSize: size,
      letterSpacing: 1.5,
    },
    text.toUpperCase(),
  );
}

const OUTCOME_LABEL: Record<Outcome, string> = { W: 'G', D: 'E', L: 'P' };

export function formDots(outcomes: Outcome[], size = 30): VNode {
  return h(
    'div',
    { gap: Math.round(size * 0.2) },
    outcomes.map((o) =>
      h(
        'div',
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.25),
          backgroundColor: o === 'W' ? palette.win : o === 'L' ? withAlpha(palette.loss, 0.9) : palette.inkHigh,
          color: o === 'W' ? palette.onAccent : palette.paper,
          border: o === 'D' ? `2px solid ${palette.line}` : 'none',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.display,
          fontWeight: 800,
          fontSize: Math.round(size * 0.55),
        },
        OUTCOME_LABEL[o],
      ),
    ),
  );
}

export interface StatBarProps {
  label: string;
  left: number;
  right: number;
  leftColor?: string;
  rightColor?: string;
  /** Texto a mostrar en lugar del número (p. ej. "2,1"). */
  leftText?: string;
  rightText?: string;
  width: number;
}

/** Barra comparativa: dos valores enfrentados y la proporción entre ellos. */
export function statBar(p: StatBarProps): VNode {
  const total = p.left + p.right;
  const leftShare = total === 0 ? 0.5 : p.left / total;
  const barWidth = p.width;
  const leftW = Math.round(barWidth * leftShare);
  const number = { fontFamily: fonts.display, fontWeight: 800, fontSize: type.big, lineHeight: 1 };
  return h(
    'div',
    { flexDirection: 'column', width: p.width, gap: 10 },
    h(
      'div',
      { justifyContent: 'space-between', alignItems: 'flex-end' },
      h('div', { ...number, color: p.left >= p.right ? palette.paper : palette.muted }, p.leftText ?? String(p.left)),
      line(p.label.toUpperCase(), { fontFamily: fonts.display, fontWeight: 600, fontSize: type.small, letterSpacing: 2, color: palette.muted }),
      h('div', { ...number, color: p.right >= p.left ? palette.paper : palette.muted }, p.rightText ?? String(p.right)),
    ),
    h(
      'div',
      { width: barWidth, height: 14, borderRadius: 7, backgroundColor: palette.inkHigh, overflow: 'hidden' },
      h('div', { width: leftW, height: 14, backgroundColor: p.leftColor ?? palette.accent }),
      h('div', { width: Math.max(0, barWidth - leftW - 4), height: 14, marginLeft: 4, backgroundColor: p.rightColor ?? palette.paper }),
    ),
  );
}

/** Barra simple de magnitud (0..max). */
export function meter(value: number, max: number, width: number, color: string = palette.accent): VNode {
  const w = max <= 0 ? 0 : Math.round((Math.min(value, max) / max) * width);
  return h('div', { width, height: 12, borderRadius: 6, backgroundColor: palette.inkHigh }, h('div', { width: Math.max(w, 6), height: 12, borderRadius: 6, backgroundColor: color }));
}

export function bigStat(value: string, label: string, opts: { size?: number; color?: string } = {}): VNode {
  return h(
    'div',
    { flexDirection: 'column', alignItems: 'flex-start' },
    h('div', { fontFamily: fonts.display, fontWeight: 800, fontSize: opts.size ?? type.headline, lineHeight: 1, color: opts.color ?? palette.paper }, value),
    line(label.toUpperCase(), { fontFamily: fonts.display, fontWeight: 600, fontSize: type.micro, letterSpacing: 2, color: palette.muted, marginTop: 6 }),
  );
}

export function card(children: VNode | VNode[], style: Record<string, string | number> = {}): VNode {
  return h('div', { backgroundColor: palette.inkRaised, borderRadius: radius.lg, border: `1px solid ${palette.line}`, ...style }, children);
}

export interface CompareRowProps {
  label: string;
  home: number;
  away: number;
  homeText?: string;
  awayText?: string;
  better: 'higher' | 'lower';
  width: number;
  numberSize?: number;
}

/**
 * Comparación enfrentada: dos barras que crecen desde el centro hacia cada equipo.
 * El lado con el mejor valor (según `better`) se pinta con el acento.
 */
export function compareRow(p: CompareRowProps): VNode {
  const max = Math.max(p.home, p.away);
  const half = Math.floor((p.width - 8) / 2);
  const len = (v: number) => (max <= 0 ? 0 : Math.max(6, Math.round((v / max) * half)));
  const homeWins = p.better === 'higher' ? p.home > p.away : p.home < p.away;
  const awayWins = p.better === 'higher' ? p.away > p.home : p.away < p.home;
  const colorOf = (wins: boolean, tie: boolean) => (wins ? palette.accent : tie ? palette.paper : palette.faint);
  const tie = !homeWins && !awayWins;
  const size = p.numberSize ?? 40;
  const number = (text: string, wins: boolean) =>
    h('div', { fontFamily: fonts.display, fontWeight: 800, fontSize: size, lineHeight: 1, color: wins ? palette.accent : tie ? palette.paper : palette.muted }, text);
  return h(
    'div',
    { flexDirection: 'column', width: p.width, gap: 8 },
    h(
      'div',
      { justifyContent: 'space-between', alignItems: 'flex-end' },
      number(p.homeText ?? String(p.home), homeWins),
      line(p.label.toUpperCase(), { fontFamily: fonts.display, fontWeight: 600, fontSize: type.micro, letterSpacing: 2, color: palette.muted, marginBottom: 4 }),
      number(p.awayText ?? String(p.away), awayWins),
    ),
    h(
      'div',
      { width: p.width, gap: 8 },
      h('div', { width: half, height: 10, justifyContent: 'flex-end', backgroundColor: palette.inkHigh, borderRadius: 5 }, h('div', { width: len(p.home), height: 10, borderRadius: 5, backgroundColor: colorOf(homeWins, tie) })),
      h('div', { width: half, height: 10, backgroundColor: palette.inkHigh, borderRadius: 5 }, h('div', { width: len(p.away), height: 10, borderRadius: 5, backgroundColor: colorOf(awayWins, tie) })),
    ),
  );
}
