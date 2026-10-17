// Token label + overlay geometry (FR-MAP-42/43, P2). The name pill is centred on the footprint's
// bottom grid line and horizontally; the pill is ≤ 20 % of a cell high unless that would make the
// font < 11 screen px; a name wider than 2 × the footprint is cut with "…". BL-04: overlay badges
// sit in rows just above the name, inside the footprint's width, so they never cover a
// neighbour's name; FR-MAP-57: a badge whose text doesn't fit is an icon chip, never cut text.
// FR-MAP-56: `layoutLabels` cuts colliding names to their footprint; `hoverTarget` picks the
// label drawn in full. The cross is a translucent X over the footprint. All lengths in map px,
// relative to the token's top-left unless said otherwise. DOM-free so it runs under `bun test`.

/** Text width in map px for a font size (map px); the canvas measures, tests fake it. */
export type Measure = (text: string, fontSize: number, bold: boolean) => number;

/** Minimum label font on screen (px). */
export const LABEL_MIN_SCREEN_FONT = 11;
/** Font never grows past this on screen (px), so zooming in doesn't blow labels up. */
export const LABEL_MAX_SCREEN_FONT = 14;
/** Pill height cap as a share of a cell. */
export const LABEL_PILL_SHARE = 0.2;
/** Pill height = font × this (vertical padding 10 % each side). */
const PILL_PER_FONT = 1.2;
/** Horizontal pill padding = font × this, each side. */
const PAD_PER_FONT = 0.4;
/** Gap between badges, and between badge rows and the name pill = font × this. */
const GAP_PER_FONT = 0.3;

export const ELLIPSIS = "…";

export interface LabelMetrics {
  font: number;
  pillH: number;
  padX: number;
  gap: number;
}

export function labelMetrics(cell: number, scale: number): LabelMetrics {
  const cap = (cell * LABEL_PILL_SHARE) / PILL_PER_FONT;
  const font = Math.max(
    LABEL_MIN_SCREEN_FONT / scale,
    Math.min(cap, LABEL_MAX_SCREEN_FONT / scale),
  );
  return {
    font,
    pillH: font * PILL_PER_FONT,
    padX: font * PAD_PER_FONT,
    gap: font * GAP_PER_FONT,
  };
}

/** `text` if it fits `maxWidth`, else the longest prefix (by code point) + "…" that does. */
export function cutToWidth(
  text: string,
  maxWidth: number,
  font: number,
  measure: Measure,
  bold = false,
): string {
  if (measure(text, font, bold) <= maxWidth) return text;
  const cps = [...text];
  let lo = 0;
  let hi = cps.length;
  // Largest n with prefix(n) + "…" ≤ maxWidth (measure is monotonic in n).
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const s = `${cps.slice(0, mid).join("").trimEnd()}${ELLIPSIS}`;
    if (measure(s, font, bold) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${cps.slice(0, lo).join("").trimEnd()}${ELLIPSIS}`;
}

export interface Pill {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BadgePill extends Pill {
  id: string;
  /** The "+N" badge only: the hidden badges' labels, for its tooltip. */
  full?: string;
  /** FR-MAP-57: an icon chip (`ICON_CHIP_PX` square, centred on its row); `text` is "". */
  compact?: boolean;
}

export interface LabelRow {
  font: number;
  name: Pill;
  badges: BadgePill[];
}

/** FR-MAP-57: an icon chip's side on screen (px). */
export const ICON_CHIP_PX = 16;

/**
 * The name pill's text and width: the name cut with "…" so the pill is ≤ `maxWidth` (FR-MAP-42:
 * 2 × the footprint; FR-MAP-56: the footprint on a collision; hover: Infinity, never cut).
 */
export function namePill(
  name: string,
  maxWidth: number,
  m: LabelMetrics,
  measure: Measure,
): { text: string; width: number } {
  const text = Number.isFinite(maxWidth)
    ? cutToWidth(name, Math.max(0, maxWidth - 2 * m.padX), m.font, measure)
    : name;
  return { text, width: measure(text, m.font, false) + 2 * m.padX };
}

/** Konva name of the "+N" badge standing for the badges that don't fit (BL-04). */
export const MORE_BADGE_ID = "map-token-badge-more";

/**
 * The label of a token whose footprint is `side` map px (= footprint × cell): the name pill
 * centred on the footprint and vertically on its bottom edge (`y = side`), no wider than
 * `nameMax` (default 2 × the footprint, FR-MAP-42). BL-04: badges in rows above it, each row
 * centred on the footprint and never wider than it, the first row right above the name, more rows
 * stacking upwards; FR-MAP-57: a badge whose text doesn't fit the footprint is an icon chip.
 * Rows never rise into the band where the upper neighbour's name sits (half a pill below the
 * footprint's top edge); what doesn't fit collapses into a last "+N" badge.
 */
export function labelRow(
  name: string,
  badges: readonly { id: string; label: string }[],
  side: number,
  cell: number,
  scale: number,
  measure: Measure,
  nameMax = 2 * side,
): LabelRow {
  const m = labelMetrics(cell, scale);
  const { text, width: nameW } = namePill(name, nameMax, m, measure);
  const y = side - m.pillH / 2;
  const chip = Math.min(side, ICON_CHIP_PX / scale);
  // Pack badges left to right into rows no wider than the footprint.
  const rows: { id: string; text: string; width: number; label: string; compact?: true }[][] = [];
  let row: (typeof rows)[number] = [];
  let rowW = 0;
  for (const b of badges) {
    const natural = measure(b.label, m.font, true) + 2 * m.padX;
    const compact = natural > side;
    const width = compact ? chip : natural;
    if (row.length > 0 && rowW + m.gap + width > side) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    rowW += (row.length > 0 ? m.gap : 0) + width;
    row.push(
      compact
        ? { id: b.id, text: "", width, label: b.label, compact: true }
        : { id: b.id, text: b.label, width, label: b.label },
    );
  }
  if (row.length > 0) rows.push(row);
  // Rows whose top stays at or below the upper neighbour's name band (pillH / 2).
  const fit = Math.max(0, Math.floor((y - m.pillH / 2) / (m.pillH + m.gap) + 1e-9));
  let hidden: (typeof rows)[number] = [];
  if (rows.length > fit) {
    hidden = rows.slice(fit).flat();
    rows.length = fit;
    const last = rows[fit - 1];
    if (last) {
      const width = (r: typeof last) => r.reduce((n, b) => n + b.width, 0) + m.gap * r.length;
      const more = () => {
        const label = `+${hidden.length}`;
        return { label, width: Math.min(side, measure(label, m.font, true) + 2 * m.padX) };
      };
      while (last.length > 0 && width(last) + more().width > side) {
        hidden.unshift(last.pop() as (typeof last)[number]);
      }
      const { label, width: w } = more();
      last.push({ id: MORE_BADGE_ID, text: label, width: w, label });
    }
  }
  const full = hidden.map((b) => b.label).join(", ");
  const out: LabelRow["badges"] = [];
  rows.forEach((r, k) => {
    const w = r.reduce((n, b) => n + b.width, 0) + m.gap * (r.length - 1);
    const by = y - (k + 1) * (m.pillH + m.gap);
    let x = (side - w) / 2;
    for (const b of r) {
      const pill = { id: b.id, text: b.text, x, y: by, width: b.width, height: m.pillH };
      if (b.id === MORE_BADGE_ID) out.push({ ...pill, full });
      else if (b.compact) {
        out.push({ ...pill, y: by + (m.pillH - b.width) / 2, height: b.width, compact: true });
      } else out.push(pill);
      x += b.width + m.gap;
    }
  });
  return {
    font: m.font,
    name: { text, x: (side - nameW) / 2, y, width: nameW, height: m.pillH },
    badges: out,
  };
}

/** FR-MAP-56: the gap a label pill keeps from another (screen px). */
export const LABEL_GAP_PX = 4;

/** A name label to lay out, in map px (absolute). */
export interface LabelBox {
  id: string;
  /** The footprint's left edge, bottom edge and side. */
  x: number;
  bottom: number;
  side: number;
  /** Its pill's width at the FR-MAP-42 limit (≤ 2 × the footprint). */
  width: number;
}

/** `layoutLabels`: a label's pill width, and whether a collision cut it. */
export interface LabelFit {
  width: number;
  cut: boolean;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The pill of `b` at `width`: centred on the footprint and on its bottom edge. */
export function pillRect(b: LabelBox, width: number, pillH: number): Rect {
  return { x: b.x + (b.side - width) / 2, y: b.bottom - pillH / 2, w: width, h: pillH };
}

/**
 * FR-MAP-56: every label keeps its FR-MAP-42 width unless its pill would come within `gap` of
 * another's; then both are cut to their own footprint (less the gap, so neighbours keep it).
 * Ordered by row, then column; pills are `pillH` high. Pure; per frame of the labels layer.
 */
export function layoutLabels(
  labels: readonly LabelBox[],
  pillH: number,
  gap: number,
): Map<string, LabelFit> {
  const sorted = [...labels].sort((a, b) => a.bottom - b.bottom || a.x - b.x);
  const rects = sorted.map((b) => pillRect(b, b.width, pillH));
  const cut = new Set<number>();
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i] as Rect;
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j] as Rect;
      if (b.y >= a.y + a.h + gap) break; // by row: no later pill reaches a's
      if (a.x < b.x + b.w + gap && b.x < a.x + a.w + gap) {
        cut.add(i);
        cut.add(j);
      }
    }
  }
  const out = new Map<string, LabelFit>();
  sorted.forEach((b, i) => {
    const own = Math.max(0, b.side - gap);
    out.set(
      b.id,
      cut.has(i) && b.width > own ? { width: own, cut: true } : { width: b.width, cut: false },
    );
  });
  return out;
}

/**
 * FR-MAP-56: the token whose label draws in full with the pointer at `p` (map px): a label pill
 * (`drawn` = its width now; topmost = last) before a footprint (topmost = last); none → null.
 */
export function hoverTarget(
  p: { x: number; y: number },
  labels: readonly (LabelBox & { drawn: number })[],
  pillH: number,
): string | null {
  const hit = (r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  for (let i = labels.length - 1; i >= 0; i--) {
    const b = labels[i] as (typeof labels)[number];
    if (hit(pillRect(b, b.drawn, pillH))) return b.id;
  }
  for (let i = labels.length - 1; i >= 0; i--) {
    const b = labels[i] as (typeof labels)[number];
    if (hit({ x: b.x, y: b.bottom - b.side, w: b.side, h: b.side })) return b.id;
  }
  return null;
}

/** Cross (FR-MAP-43): two strokes corner to corner, inset 15 %, stroke ≈ 12 % of the side. */
export const CROSS_INSET = 0.15;
export const CROSS_STROKE = 0.12;
export const CROSS_OPACITY = 0.6;

export function crossGeometry(side: number): {
  segments: [[number, number, number, number], [number, number, number, number]];
  strokeWidth: number;
} {
  const a = side * CROSS_INSET;
  const b = side - a;
  return {
    segments: [
      [a, a, b, b],
      [b, a, a, b],
    ],
    strokeWidth: side * CROSS_STROKE,
  };
}
