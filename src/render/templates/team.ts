// 6. Estadísticas por equipo: últimos 5, goles, local/visitante, vallas invictas y rachas.

import type { TeamStatsView } from '../../content/views.ts';
import { frame, type BrandInfo } from '../../design/components/brand.ts';
import { bigStat, card, chip, statBar } from '../../design/components/stats.ts';
import { teamMark } from '../../design/components/team.ts';
import { withAlpha } from '../../design/color.ts';
import { h, line, type VNode } from '../../design/h.ts';
import { fitSize } from '../../design/text-fit.ts';
import { fonts, palette, type, type Format } from '../../design/tokens.ts';
import type { Streaks } from '../../stats/team.ts';
import { contentWidth, isCompact, sectionLabel } from './common.ts';

export function teamTemplate(view: TeamStatsView, format: Format, brand: BrandInfo): VNode {
  const width = contentWidth(format);
  const compact = isCompact(format);
  const p = view.profile;
  const tile = Math.floor((width - 4 * 14) / 5);

  const header = h(
    'div',
    { alignItems: 'center', gap: 28, width },
    teamMark(view.team, compact ? 104 : 128),
    h(
      'div',
      { flexDirection: 'column', gap: 10 },
      line(view.team.name.toUpperCase(), { fontFamily: fonts.display, fontWeight: 800, fontSize: fitSize(view.team.name, width - 180, 64, 36, 'display'), color: palette.paper, maxWidth: width - 160 }),
      view.position ? h('div', { gap: 10 }, chip(`${view.position.rank}º · ${view.position.table}`, 'accent'), chip(`${view.position.points} pts`, 'muted')) : null,
    ),
  );

  const formTiles = h(
    'div',
    { gap: 14, width },
    view.last5.map((e) =>
      h(
        'div',
        {
          width: tile,
          height: compact ? 112 : 136,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 16,
          backgroundColor: e.outcome === 'W' ? palette.win : e.outcome === 'L' ? withAlpha(palette.loss, 0.85) : palette.inkHigh,
          color: e.outcome === 'D' ? palette.paper : '#ffffff',
          gap: 4,
        },
        h('div', { fontFamily: fonts.display, fontWeight: 800, fontSize: compact ? 40 : 48, lineHeight: 1 }, `${e.goalsFor}-${e.goalsAgainst}`),
        h('div', { fontFamily: fonts.display, fontWeight: 700, fontSize: type.micro, letterSpacing: 1.5 }, `${e.home ? 'VS' : 'EN'} ${e.opponent.abbr}`),
      ),
    ),
  );

  const bars = card(
    [
      statBar({ label: 'Goles a favor · en contra', left: p.total.goalsFor, right: p.total.goalsAgainst, width: width - 48, rightColor: palette.loss }),
      statBar({ label: 'Puntos de local · de visita', left: p.home.points, right: p.away.points, width: width - 48, rightColor: palette.paper }),
    ],
    { flexDirection: 'column', gap: compact ? 18 : 28, padding: compact ? '20px 24px' : '28px 24px' },
  );

  const record = (s: typeof p.home) => `${s.won}G ${s.drawn}E ${s.lost}P`;
  const stats = h(
    'div',
    { justifyContent: 'space-between', width, padding: '0 8px' },
    bigStat(String(p.total.cleanSheets), 'vallas invictas', { color: palette.accent }),
    bigStat(record(p.home), 'de local', { size: compact ? 40 : 48 }),
    bigStat(record(p.away), 'de visita', { size: compact ? 40 : 48 }),
    bigStat(streakText(p.streaks).value, streakText(p.streaks).label, { size: compact ? 40 : 48 }),
  );

  const avg = (n: number) => (p.total.played ? (n / p.total.played).toFixed(2).replace('.', ',') : '0');
  const extra = compact
    ? null
    : h(
        'div',
        { justifyContent: 'space-between', width, padding: '0 8px', marginTop: 28, borderTop: `1px solid ${palette.line}`, paddingTop: 28 },
        bigStat(avg(p.total.goalsFor), 'goles por partido', { size: 48 }),
        bigStat(avg(p.total.goalsAgainst), 'recibidos por partido', { size: 48 }),
        bigStat(String(p.total.failedToScore), 'partidos sin marcar', { size: 48 }),
        p.biggestWin ? bigStat(`${p.biggestWin.goalsFor}-${p.biggestWin.goalsAgainst}`, 'mayor victoria', { size: 48 }) : null,
      );

  const body = [
    header,
    h('div', { flexDirection: 'column', gap: 12, marginTop: compact ? 22 : 36 }, sectionLabel('Últimos 5 partidos'), formTiles),
    h('div', { marginTop: compact ? 18 : 28 }, bars),
    h('div', { marginTop: compact ? 18 : 32 }, stats),
    extra,
  ];
  return frame({ format, brand, competition: view.competition, kicker: view.kicker, title: 'Radiografía', titleAccent: 'Radiografía', body });
}

function streakText(s: Streaks): { value: string; label: string } {
  if (s.wins >= 2) return { value: String(s.wins), label: 'victorias seguidas' };
  if (s.unbeaten >= 3) return { value: String(s.unbeaten), label: 'partidos invicto' };
  if (s.losses >= 2) return { value: String(s.losses), label: 'derrotas seguidas' };
  if (s.winless >= 3) return { value: String(s.winless), label: 'partidos sin ganar' };
  return { value: String(s.scoring), label: 'partidos marcando' };
}
