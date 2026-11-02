// Tarjeta de partido en una fila: local · centro (hora o marcador) · visitante.

import { withAlpha } from '../color.ts';
import { h, line, type VNode } from '../h.ts';
import { fonts, palette, radius } from '../tokens.ts';
import { teamLabel, type TeamVisual } from './team.ts';

export interface MatchRowProps {
  home: TeamVisual;
  away: TeamVisual;
  width: number;
  height: number;
  /** Texto central: "19:00" o "2 - 1". */
  center: string;
  centerTone?: 'score' | 'time' | 'pending';
  /** Línea secundaria bajo los equipos (estadio, nota). */
  note?: string;
  /** Lado izquierdo opcional (p. ej. la hora en la cartelera). */
  lead?: string;
  highlight?: boolean;
}

export function matchRow(p: MatchRowProps): VNode {
  const hasNote = Boolean(p.note);
  // Un escudo no tiene recuadro de color: puede ocupar casi todo el alto para conservar su detalle.
  const withLogos = Boolean(p.home.logo || p.away.logo);
  const inner = p.height - (withLogos ? 8 : 16);
  const tileSize = Math.min(64, Math.round((p.height - 16) * (hasNote ? 0.6 : 0.82)));
  const markSize = withLogos ? Math.min(84, Math.round(inner * (hasNote ? 0.66 : 0.96))) : tileSize;
  const nameSize = Math.min(36, Math.round(tileSize * 0.6));
  const leadWidth = p.lead ? 112 : 0;
  const centerWidth = p.centerTone === 'score' ? 150 : 120;
  const gap = 16;
  const side = Math.floor((p.width - leadWidth - centerWidth - 48 - 2 * gap) / 2);

  const center = h(
    'div',
    {
      width: centerWidth,
      height: tileSize,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: p.centerTone === 'score' ? palette.inkHigh : 'transparent',
      fontFamily: fonts.display,
      fontWeight: 800,
      fontSize: p.centerTone === 'score' ? Math.round(tileSize * 0.7) : Math.round(tileSize * 0.5),
      color: p.centerTone === 'pending' ? palette.muted : p.centerTone === 'time' ? palette.muted : palette.paper,
      letterSpacing: 1,
    },
    p.center,
  );

  return h(
    'div',
    {
      width: p.width,
      height: p.height,
      alignItems: 'center',
      padding: '0 24px',
      borderRadius: radius.md,
      backgroundColor: p.highlight ? withAlpha(palette.accent, 0.07) : palette.inkRaised,
      border: `1px solid ${p.highlight ? palette.accent : palette.line}`,
    },
    p.lead
      ? line(p.lead, { width: leadWidth, fontFamily: fonts.display, fontWeight: 800, fontSize: Math.round(tileSize * 0.6), color: palette.accent })
      : null,
    h(
      'div',
      { flexDirection: 'column', flexGrow: 1, justifyContent: 'center' },
      h(
        'div',
        { alignItems: 'center', justifyContent: 'space-between', gap },
        teamLabel(p.home, { size: markSize, fontSize: nameSize, align: 'right', width: side }),
        center,
        teamLabel(p.away, { size: markSize, fontSize: nameSize, align: 'left', width: side }),
      ),
      hasNote
        ? line(p.note!, { marginTop: 6, fontSize: 19, color: palette.faint, justifyContent: 'center', textAlign: 'center', width: p.width - leadWidth - 48 })
        : null,
    ),
  );
}
