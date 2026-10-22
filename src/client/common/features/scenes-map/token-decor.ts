// Bar + icon row geometry for token overlays (OQ-CBTX-21: `bar`, `icons`), in token-group
// coordinates (origin = footprint top-left, `side` = footprint px). Bar on the top edge; icons in
// a row below it, top-left; at most `ICONS_MAX`, then a "+N" chip; each one's hover tooltip and
// muted tone (FR-MAP-57, S9: generic, so R's trigger icon keeps its own). Cue ring + bell (FR-MAP-49).
// Turn ring (FR-MAP-108 / -109). DOM-free (tested under bun).
import type { TokenShape } from "@shared/scenes-map/schemas";
import { CASING_EXTRA_PX } from "./mark-colors";
import { outlineOf } from "./shape";
import type { TokenBar, TokenIcon } from "./token-overlays";

export const BAR_INSET = 0.1;
export const BAR_TOP = 0.03;
export const BAR_HEIGHT = 0.08;
export const ICON_SIZE = 0.18;
export const ICON_GAP = 0.02;
export const ICONS_MAX = 4;

export interface Span {
  x: number;
  width: number;
}

export interface BarGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Muted track under a proportional fill; none for a full-width (no proportion) bar. */
  track: boolean;
  fill: Span | null;
  temp: Span | null;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** FR-CBTX-28: fill = fraction (null → full width), temp after it, together ≤ 100 %. */
export function barGeometry(side: number, bar: TokenBar): BarGeometry {
  const x = side * BAR_INSET;
  const width = side * (1 - 2 * BAR_INSET);
  const base = { x, y: side * BAR_TOP, width, height: side * BAR_HEIGHT };
  if (bar.fraction === null) {
    return { ...base, track: false, fill: { x, width }, temp: null };
  }
  const f = clamp01(bar.fraction);
  const t = Math.min(clamp01(bar.temp ?? 0), 1 - f);
  return {
    ...base,
    track: true,
    fill: f > 0 ? { x, width: width * f } : null,
    temp: t > 0 ? { x: x + width * f, width: width * t } : null,
  };
}

export interface IconCell {
  icon: TokenIcon;
  /** Initials drawn in the disc. */
  text: string;
  /** Hover tooltip (the icon's label). */
  tip: string;
  /** Drawn in the muted tone (`TokenIcon.muted`). */
  muted: boolean;
  x: number;
  y: number;
  size: number;
}

export interface IconRow {
  items: IconCell[];
  /** "+N" for the icons past `ICONS_MAX`; null when all fit. */
  more: { text: string; count: number; tip: string; x: number; y: number; size: number } | null;
}

/** "Prone" → "Pr", "Exhaustion 2" → "E2", "" → "?". */
export function iconText(label: string): string {
  const s = label.trim();
  const level = /\s(\d+)$/.exec(s)?.[1];
  const first = [...s][0]?.toUpperCase() ?? "?";
  if (level) return `${first}${level}`;
  const second = [...s][1];
  return second && /\p{L}/u.test(second) ? `${first}${second.toLowerCase()}` : first;
}

/** FR-MAP-49 cue: ring just outside the art, bell disc centred on the top-right corner. */
export const CUE_RING = 0.56;
export const CUE_BELL = 0.17;
export const CUE_PERIOD_MS = 1200;

export interface CueGeometry {
  ring: { x: number; y: number; radius: number; strokeWidth: number };
  bell: { x: number; y: number; radius: number };
}

export function cueGeometry(side: number): CueGeometry {
  return {
    ring: { x: side / 2, y: side / 2, radius: side * CUE_RING, strokeWidth: side * 0.06 },
    bell: { x: side, y: 0, radius: side * CUE_BELL },
  };
}

/** Pulse at `ms`: ring opacity 0.35–1 and scale 1–1.12 per period; reduced motion → steady. */
export function cuePulse(ms: number, reducedMotion: boolean): { opacity: number; scale: number } {
  if (reducedMotion) return { opacity: 1, scale: 1 };
  const k = (1 - Math.cos((2 * Math.PI * (ms % CUE_PERIOD_MS)) / CUE_PERIOD_MS)) / 2;
  return { opacity: 1 - 0.65 * k, scale: 1 + 0.12 * k };
}

/** FR-CBTX-29: max 4 icons left to right below the bar, then "+N". */
export function iconRow(side: number, icons: readonly TokenIcon[]): IconRow {
  const size = side * ICON_SIZE;
  const step = size + side * ICON_GAP;
  const y = side * (BAR_TOP + BAR_HEIGHT + ICON_GAP);
  const x0 = side * ICON_GAP;
  const shown = icons.slice(0, ICONS_MAX);
  const items = shown.map((icon, i) => ({
    icon,
    text: iconText(icon.label),
    tip: icon.label,
    muted: icon.muted === true,
    x: x0 + i * step,
    y,
    size,
  }));
  const hidden = icons.slice(ICONS_MAX);
  const more =
    hidden.length > 0
      ? {
          text: `+${hidden.length}`,
          count: hidden.length,
          tip: hidden.map((i) => i.label).join("\n"),
          x: x0 + shown.length * step,
          y,
          size,
        }
      : null;
  return { items, more };
}

/** Token art / outline radius share of half the footprint (TokensLayer's disc and ring). */
export const TOKEN_INSET = 0.92;
/** The selection / target outline's stroke, screen px (TokensLayer's `TokenOutline`). */
export const OUTLINE_PX = 3;

/** FR-MAP-109: below this cell size on screen (BL-35's compact rule) the ring is thin, no glow. */
export const TURN_SMALL_CELL_PX = 48;
export const TURN_RING_PX = 3;
export const TURN_RING_SMALL_PX = 2;
/** Gap past the selection / target outline's outer edge, screen px, so both read at once. */
export const TURN_GAP_PX = 1;
/** Soft outer glow (shadow blur), screen px. */
export const TURN_GLOW_PX = 10;
/** `hidden` (DM only): dash, gap in screen px. */
export const TURN_DASH_PX = [6, 4] as const;

export interface TurnRingGeometry {
  kind: "circle" | "square";
  /** Bounding box of the stroke's centre line, token-group px (origin = footprint top-left). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Circle radius, or the square's corner radius. */
  radius: number;
  strokeWidth: number;
  /** The dark casing under the ring (FR-MAP-72): 2 screen px wider. */
  casingWidth: number;
  dash: number[] | null;
  /** Shadow blur in map px; null = no glow (hidden, small cells). */
  glow: number | null;
}

/**
 * FR-MAP-109: a ring hugging the footprint's shape (circle or square, FR-MAP-26) just outside the
 * selection / target outline, plus a soft glow; dashed with no glow when `hidden`; cells under
 * 48 screen px → a 2 px ring, no glow. Widths are screen px at camera `scale` (map px out).
 */
export function turnRingGeometry(p: {
  side: number;
  shape: TokenShape;
  hidden: boolean;
  scale: number;
  cellPx: number;
}): TurnRingGeometry {
  const small = p.cellPx < TURN_SMALL_CELL_PX;
  const w = small ? TURN_RING_SMALL_PX : TURN_RING_PX;
  const strokeWidth = w / p.scale;
  // Centre line: the outline's outer edge + the gap + half the ring.
  const off = (OUTLINE_PX / 2 + TURN_GAP_PX + w / 2) / p.scale;
  const r = p.side / 2;
  const common = {
    strokeWidth,
    casingWidth: (w + CASING_EXTRA_PX) / p.scale,
    dash: p.hidden ? TURN_DASH_PX.map((d) => d / p.scale) : null,
    glow: p.hidden || small ? null : TURN_GLOW_PX / p.scale,
  };
  if (outlineOf(p.shape) === "circle") {
    const radius = r * TOKEN_INSET + off;
    const d = 2 * radius;
    return { kind: "circle", x: r - radius, y: r - radius, width: d, height: d, radius, ...common };
  }
  // The square outline's inset (none: the footprint's edge).
  const inset = (p.shape === "none" ? 0 : r * (1 - TOKEN_INSET) * 0.5) - off;
  const d = p.side - 2 * inset;
  return { kind: "square", x: inset, y: inset, width: d, height: d, radius: off, ...common };
}
