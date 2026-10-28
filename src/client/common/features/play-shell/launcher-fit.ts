// Launcher fit (FR-SHELL-43, OQ-SHELL-25): the bar never overflows its zone (kit-parity FR-KIT-14:
// the top bar's centre, between the title and the right cluster; 8 px gutter each side). Too wide → buttons drop their labels (icon only), highest `order` first, keeping the
// labels that fit (sprint 11 F1, BL-113); every button icon-only and still too wide → buttons move
// into the trailing "⋯" menu, closed windows first, highest `order` first. Pure; the widths are
// measured by the caller (`Launcher.tsx`).
import type { LauncherState } from "./manager";

/** Space kept free between the bar and each edge of its zone, px. */
export const LAUNCHER_GUTTER = 8;

export interface LauncherItem {
  kind: string;
  /** Launcher order (ascending, left to right). */
  order: number;
  state: LauncherState;
}

export interface LauncherMetrics {
  /** Width of each button with its label, px. */
  full: (kind: string) => number;
  /** Width of an icon-only button, px. */
  compact: number;
  /** Width of the "⋯" trigger, px. */
  menu: number;
  /** Gap between two buttons, px. */
  gap: number;
  /** The bar's own padding + border, both sides, px. */
  pad: number;
}

export interface LauncherFit {
  /** Some button is icon-only (`data-compact`). */
  compact: boolean;
  /** Kinds in the bar that keep their label (BL-113: the lowest `order` first, where they fit). */
  labelled: string[];
  /** Kinds in the bar, launcher order. */
  bar: string[];
  /** Kinds in the "⋯" menu, launcher order. */
  overflow: string[];
}

/**
 * The narrowest zone the launcher needs: the "⋯" trigger alone in its bar, plus the gutters
 * (FR-KIT-14: the top bar's title shrinks first, so "⋯" and Reset layout stay reachable).
 */
export const LAUNCHER_MIN_ZONE = 2 * LAUNCHER_GUTTER + 2 * 4 + 2 * 1 + 40;

// Widths from `Launcher.tsx`'s classes: `size="sm"` button = px-3 (24) + icon 16, label
// `text-xs` after `gap-1.5`; bar `p-1` + a transparent border, buttons `gap-1`.
const ICON_BUTTON_W = 40;
const LABEL_GAP = 6;

/** Label type size, px (`LAUNCHER_FONT`: `text-xs`). */
export const LABEL_PX = 12;

/**
 * BL-136 (FR-THEME-05): Gilt & Stone's label face (`--font-label`, weight 400), its
 * advance per character U+0020–U+007E in font units (`GILT_LABEL_UPEM` per em), read off the
 * committed `themes/fonts/im-fell-english-sc-400.latin.woff2` (test `BL-136 the Gilt label table
 * is the committed font's`). A table, not a canvas measure: the face downloads only while Gilt &
 * Stone is on (FR-THEME-16), so a measure would differ by theme.
 */
export const GILT_LABEL_UPEM = 2048;
export const GILT_LABEL_ADVANCE: readonly number[] = [
  439, 558, 1018, 1644, 1134, 1529, 1536, 558, 532, 526, 1010, 1153, 541, 951, 441, 696, 1004, 753,
  958, 761, 999, 744, 862, 948, 804, 892, 534, 566, 1116, 931, 1114, 740, 1540, 1380, 1351, 1465,
  1643, 1418, 1301, 1630, 1756, 880, 831, 1479, 1457, 1926, 1766, 1695, 1184, 1678, 1544, 1050,
  1495, 1729, 1343, 1957, 1655, 1394, 1456, 866, 589, 915, 964, 966, 1071, 895, 858, 999, 1073, 939,
  848, 1016, 1189, 625, 612, 1047, 888, 1409, 1150, 1103, 879, 1151, 989, 712, 1049, 1149, 917,
  1282, 971, 916, 933, 839, 496, 844, 1120,
];

/**
 * A label's width in Gilt & Stone's label face, px (no kerning: never narrower than drawn); a
 * character outside the table counts as the widest one.
 */
export function giltLabelWidth(label: string): number {
  const widest = Math.max(...GILT_LABEL_ADVANCE);
  let units = 0;
  for (const ch of label) units += GILT_LABEL_ADVANCE[(ch.codePointAt(0) ?? 0) - 32] ?? widest;
  return Math.ceil((units * LABEL_PX) / GILT_LABEL_UPEM) + 1;
}

/** The launcher's metrics, given each kind's label and a label width measure (px). */
export function launcherMetrics(
  labels: ReadonlyMap<string, string>,
  labelWidth: (label: string) => number,
): LauncherMetrics {
  return {
    full: (kind) => ICON_BUTTON_W + LABEL_GAP + labelWidth(labels.get(kind) ?? ""),
    compact: ICON_BUTTON_W,
    menu: ICON_BUTTON_W,
    gap: 4,
    pad: 2 * 4 + 2 * 1,
  };
}

/** Width of the bar holding `widths` plus the "⋯" trigger. */
function barWidth(widths: readonly number[], m: LauncherMetrics): number {
  return m.pad + widths.reduce((s, w) => s + w, 0) + m.menu + m.gap * widths.length;
}

/** Width of the bar `fit` draws, px (centred: the gutter each side is half of what is left). */
export function fittedBarWidth(fit: LauncherFit, m: LauncherMetrics): number {
  const labelled = new Set(fit.labelled);
  return barWidth(
    fit.bar.map((k) => (labelled.has(k) ? m.full(k) : m.compact)),
    m,
  );
}

/** `items` in launcher order; `zoneW` = the width of the launcher's zone (FR-KIT-14), px. */
export function fitLauncher(
  items: readonly LauncherItem[],
  zoneW: number,
  m: LauncherMetrics,
): LauncherFit {
  const room = zoneW - 2 * LAUNCHER_GUTTER;
  const kinds = items.map((i) => i.kind);
  if (barWidth(kinds.map(m.full), m) <= room) {
    return { compact: false, labelled: kinds, bar: kinds, overflow: [] };
  }
  const fits = (n: number) => barWidth(new Array<number>(n).fill(m.compact), m) <= room;
  if (fits(items.length)) {
    // BL-113: the labels that fit stay, the lowest order first (the bar stays put as windows
    // open and close: state doesn't count).
    const byOrder = [...items].sort((a, b) => a.order - b.order);
    const labelled = new Set<string>();
    let width = barWidth(new Array<number>(items.length).fill(m.compact), m);
    for (const item of byOrder) {
      const more = m.full(item.kind) - m.compact;
      if (width + more > room) break;
      width += more;
      labelled.add(item.kind);
    }
    return {
      compact: true,
      labelled: kinds.filter((k) => labelled.has(k)),
      bar: kinds,
      overflow: [],
    };
  }
  // Closed before open / minimised, then highest order first.
  const leaving = [...items].sort(
    (a, b) => Number(b.state === "closed") - Number(a.state === "closed") || b.order - a.order,
  );
  const out = new Set<string>();
  for (const item of leaving) {
    if (fits(items.length - out.size)) break;
    out.add(item.kind);
  }
  return {
    compact: true,
    labelled: [],
    bar: kinds.filter((k) => !out.has(k)),
    overflow: kinds.filter((k) => out.has(k)),
  };
}
