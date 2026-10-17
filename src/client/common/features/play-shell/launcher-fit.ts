// Launcher fit (FR-SHELL-43, OQ-SHELL-25): the bar never overflows the viewport (8 px gutter each
// side). Too wide → every button drops its label (icon only); still too wide → buttons move into
// the trailing "⋯" menu, closed windows first, highest `order` first. Pure; the widths are
// measured by the caller (`Launcher.tsx`).
import type { LauncherState } from "./manager";

/** Space kept free between the bar and each viewport edge, px. */
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
  /** Icon-only buttons (`data-compact`). */
  compact: boolean;
  /** Kinds in the bar, launcher order. */
  bar: string[];
  /** Kinds in the "⋯" menu, launcher order. */
  overflow: string[];
}

// Widths from `Launcher.tsx`'s classes: `size="sm"` button = px-3 (24) + icon 16, label
// `text-xs` after `gap-1.5`; bar `p-1` + border, buttons `gap-1`.
const ICON_BUTTON_W = 40;
const LABEL_GAP = 6;

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
  return barWidth(
    fit.bar.map((k) => (fit.compact ? m.compact : m.full(k))),
    m,
  );
}

/** `items` in launcher order; `vpW` = viewport width. */
export function fitLauncher(
  items: readonly LauncherItem[],
  vpW: number,
  m: LauncherMetrics,
): LauncherFit {
  const room = vpW - 2 * LAUNCHER_GUTTER;
  const kinds = items.map((i) => i.kind);
  if (barWidth(kinds.map(m.full), m) <= room) return { compact: false, bar: kinds, overflow: [] };
  const fits = (n: number) => barWidth(new Array<number>(n).fill(m.compact), m) <= room;
  if (fits(items.length)) return { compact: true, bar: kinds, overflow: [] };
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
    bar: kinds.filter((k) => !out.has(k)),
    overflow: kinds.filter((k) => out.has(k)),
  };
}
