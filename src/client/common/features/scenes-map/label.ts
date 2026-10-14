// Token label + overlay geometry (FR-MAP-42/43, P2). A label row (name pill, then overlay badges)
// is centred on the footprint's bottom grid line, the name centred horizontally; the pill is
// ≤ 20 % of a cell high unless that would make the font < 11 screen px; a name wider than 2 × the
// footprint is cut with "…". The cross is a translucent X over the footprint. All lengths in map
// px, relative to the token's top-left. DOM-free so it runs under `bun test`.

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
/** Gap between the name pill and each badge = font × this. */
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
  badges: (Pill & { id: string })[];
}

/**
 * The label row of a token whose footprint is `side` map px (= footprint × cell): the name pill
 * centred on the footprint and vertically on its bottom edge (`y = side`), badges after it.
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
  const nameX = (side - nameW) / 2;
  let x = nameX + nameW;
  const out: LabelRow["badges"] = [];
  for (const b of badges) {
    x += m.gap;
    const width = measure(b.label, m.font, true) + 2 * m.padX;
    out.push({ id: b.id, text: b.label, x, y, width, height: m.pillH });
    x += width;
  }
  return {
    font: m.font,
    name: { text, x: nameX, y, width: nameW, height: m.pillH },
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
