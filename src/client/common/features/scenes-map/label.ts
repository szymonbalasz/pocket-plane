// Token label + overlay geometry (FR-MAP-42/43, P2). The name pill is centred on the footprint's
// bottom grid line and horizontally; the pill is ≤ 20 % of a cell high unless that would make the
// font < 11 screen px; a name wider than 2 × the footprint is cut with "…". BL-04: overlay badges
// sit in rows just above the name, inside the footprint's width, so they never cover a
// neighbour's name. The cross is a translucent X over the footprint. All lengths in map px,
// relative to the token's top-left. DOM-free so it runs under `bun test`.

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

export interface LabelRow {
  font: number;
  name: Pill;
  /** `full` (the "+N" badge only): the hidden badges' labels, for its tooltip. */
  badges: (Pill & { id: string; full?: string })[];
}

/** Konva name of the "+N" badge standing for the badges that don't fit (BL-04). */
export const MORE_BADGE_ID = "map-token-badge-more";

/**
 * The label of a token whose footprint is `side` map px (= footprint × cell): the name pill
 * centred on the footprint and vertically on its bottom edge (`y = side`). BL-04: badges in rows
 * above it, each row centred on the footprint and never wider than it (a badge wider than the
 * footprint is cut with "…"), the first row right above the name, more rows stacking upwards.
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
): LabelRow {
  const m = labelMetrics(cell, scale);
  const text = cutToWidth(name, 2 * side - 2 * m.padX, m.font, measure);
  const nameW = measure(text, m.font, false) + 2 * m.padX;
  const y = side - m.pillH / 2;
  // Pack badges left to right into rows no wider than the footprint.
  const rows: { id: string; text: string; width: number; label: string }[][] = [];
  let row: (typeof rows)[number] = [];
  let rowW = 0;
  for (const b of badges) {
    const label = cutToWidth(b.label, Math.max(0, side - 2 * m.padX), m.font, measure, true);
    const width = Math.min(side, measure(label, m.font, true) + 2 * m.padX);
    if (row.length > 0 && rowW + m.gap + width > side) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    rowW += (row.length > 0 ? m.gap : 0) + width;
    row.push({ id: b.id, text: label, width, label: b.label });
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
      out.push(b.id === MORE_BADGE_ID ? { ...pill, full } : pill);
      x += b.width + m.gap;
    }
  });
  return {
    font: m.font,
    name: { text, x: (side - nameW) / 2, y, width: nameW, height: m.pillH },
    badges: out,
  };
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
