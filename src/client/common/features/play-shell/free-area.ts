// Free area (FR-SHELL-34, R1): the largest part of the work area, right of the tool rail, that no
// rendered open window covers, plus a counter of window *appearances* (a window rendered because
// its kind became available while open, or a feature-driven open noted by `noteAppearance()`).
// The map frames its tokens there (FR-MAP-44). Read-only: nothing stored or sent.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type Rect, TOP_BAR_H, type Viewport, windowRect, workArea } from "./geometry";
import { useViewport } from "./hooks";
import { type Windows, windowId } from "./manager";
import { RAIL_CLEAR } from "./placement";
import type { WindowRegistry } from "./registry";
import { useAvailableKinds, useRegistry, useShellState } from "./ShellContext";

/** Below this size (or share of the work area) the free area falls back to the work area. */
export const FREE_MIN_W = 320;
export const FREE_MIN_H = 240;
export const FREE_MIN_SHARE = 0.25;

/** The work area right of the tool rail, in viewport px. */
export function railArea(vp: Viewport): Rect {
  const wa = workArea(vp);
  return { x: RAIL_CLEAR, y: TOP_BAR_H, w: Math.max(1, wa.w - RAIL_CLEAR), h: wa.h };
}

// ---- measured content heights (FR-SHELL-39) ----

/** Window id (`kind:instance`) → window height its content asks for, reported by `ShellWindow`. */
let heights: ReadonlyMap<string, number> = new Map();
const heightListeners = new Set<() => void>();

/** `ShellWindow` of a `growToContent` type reports its needed height; null = gone / not growing. */
export function reportContentHeight(id: string, h: number | null): void {
  if (h === null ? !heights.has(id) : heights.get(id) === h) return;
  const next = new Map(heights);
  if (h === null) next.delete(id);
  else next.set(id, h);
  heights = next;
  for (const fn of [...heightListeners]) fn();
}

/** The heights reported so far on this page (a new Map on every change). */
export function contentHeights(): ReadonlyMap<string, number> {
  return heights;
}

const subscribeHeights = (fn: () => void) => {
  heightListeners.add(fn);
  return () => {
    heightListeners.delete(fn);
  };
};

/** Re-renders when a grown window's content height changes. */
export function useContentHeights(): ReadonlyMap<string, number> {
  return useSyncExternalStore(subscribeHeights, contentHeights, contentHeights);
}

/**
 * What each rendered window covers: open, available, fitted and clamped as `ShellWindow` draws it,
 * a `growToContent` window at its measured grown height (FR-SHELL-39). Every consumer of window
 * rects (free area, toast keep-out, attack popup) reads them here.
 */
export function renderedWindowRects(
  windows: Windows,
  registry: WindowRegistry,
  available: ReadonlySet<string>,
  vp: Viewport,
  measured: ReadonlyMap<string, number> = contentHeights(),
): Rect[] {
  const out: Rect[] = [];
  for (const w of windows) {
    const def = registry.get(w.kind);
    if (!def || w.state !== "open" || !available.has(w.kind)) continue;
    out.push(windowRect(w, def, vp, measured.get(windowId(w.kind, w.instance))));
  }
  return out;
}

/**
 * The largest axis-aligned rectangle inside the work area, right of the rail, that none of
 * `rects` overlaps. Ties → the higher, then the more left one. Smaller than 320×240 or than 25 %
 * of the work area → the work area right of the rail.
 */
export function freeArea(rects: readonly Rect[], vp: Viewport): Rect {
  const bounds = railArea(vp);
  const bx1 = bounds.x + bounds.w;
  const by1 = bounds.y + bounds.h;
  const obstacles: Rect[] = [];
  for (const r of rects) {
    const x0 = Math.max(bounds.x, r.x);
    const y0 = Math.max(bounds.y, r.y);
    const x1 = Math.min(bx1, r.x + r.w);
    const y1 = Math.min(by1, r.y + r.h);
    if (x1 > x0 && y1 > y0) obstacles.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  // A maximal empty rectangle has every side on the bounds or on an obstacle edge.
  const xs = [...new Set([bounds.x, bx1, ...obstacles.flatMap((o) => [o.x, o.x + o.w])])].sort(
    (a, b) => a - b,
  );
  const ys = [...new Set([bounds.y, by1, ...obstacles.flatMap((o) => [o.y, o.y + o.h])])].sort(
    (a, b) => a - b,
  );
  let best: Rect | null = null;
  let bestArea = 0;
  for (let i = 0; i < ys.length; i++) {
    for (let j = i + 1; j < ys.length; j++) {
      const y0 = ys[i] as number;
      const y1 = ys[j] as number;
      const across = obstacles.filter((o) => o.y < y1 && y0 < o.y + o.h);
      for (let k = 0; k < xs.length; k++) {
        for (let l = k + 1; l < xs.length; l++) {
          const x0 = xs[k] as number;
          const x1 = xs[l] as number;
          // Wider ones from this left edge only hit more obstacles.
          if (across.some((o) => o.x < x1 && x0 < o.x + o.w)) break;
          const area = (x1 - x0) * (y1 - y0);
          const better =
            area > bestArea ||
            (area === bestArea && best !== null && (y0 < best.y || (y0 === best.y && x0 < best.x)));
          if (better) {
            best = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
            bestArea = area;
          }
        }
      }
    }
  }
  const wa = workArea(vp);
  const tooSmall =
    !best || best.w < FREE_MIN_W || best.h < FREE_MIN_H || bestArea < FREE_MIN_SHARE * wa.w * wa.h;
  return tooSmall || !best ? bounds : best;
}

// ---- appearances ----

/** What the appearance tracker compares between renders. */
export interface AvailabilitySeen {
  /** Layout key; null before the first snapshot. */
  key: string | null;
  kinds: ReadonlySet<string>;
}

/**
 * One appearance iff, under the same layout key, at least one kind became available whose
 * window is open (so it is rendered now). Several kinds in one change (a reconnect snapshot)
 * count once. A restore (first snapshot, campaign switch), a user open / restore (availability
 * unchanged) and a snapshot with no newly available kind don't count.
 */
export function isAppearance(
  prev: AvailabilitySeen | null,
  next: AvailabilitySeen,
  windows: Windows,
): boolean {
  if (!prev || next.key === null || prev.key !== next.key) return false;
  for (const kind of next.kinds) {
    if (prev.kinds.has(kind)) continue;
    if (windows.some((w) => w.kind === kind && w.state === "open")) return true;
  }
  return false;
}

let noted = 0;
const listeners = new Set<() => void>();

/**
 * A feature opened a window the map should make room for (FR-CBT-60: the DM's own Start).
 * Call it after the window change is dispatched; counts one appearance (FR-SHELL-34).
 */
export function noteAppearance(): void {
  noted += 1;
  for (const fn of [...listeners]) fn();
}

/** Appearances noted so far on this page (tests, `useFreeArea`). */
export function notedAppearances(): number {
  return noted;
}

const subscribeNoted = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export interface FreeAreaState {
  /** Free area in viewport px (the canvas fills the viewport). */
  area: Rect;
  /** Grows by one per appearance; compare with a previous value, never read as a total. */
  appearances: number;
  /** The layout is applied (FR-SHELL-16): a fit before that would use no windows. */
  ready: boolean;
}

/** FR-SHELL-34: the free area of what is rendered now, and the appearance counter. */
export function useFreeArea(): FreeAreaState {
  const registry = useRegistry();
  const windows = useShellState((s) => s.windows);
  const key = useShellState((s) => s.key);
  const available = useAvailableKinds();
  const vp = useViewport();
  const measured = useContentHeights();
  const area = useMemo(
    () => freeArea(renderedWindowRects(windows, registry, available, vp, measured), vp),
    [windows, registry, available, vp, measured],
  );
  const notedNow = useSyncExternalStore(subscribeNoted, notedAppearances);
  const [flips, setFlips] = useState(0);
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const seen = useRef<AvailabilitySeen | null>(null);
  useEffect(() => {
    const next = { key, kinds: available };
    if (isAppearance(seen.current, next, windowsRef.current)) setFlips((n) => n + 1);
    seen.current = next;
  }, [key, available]);
  return { area, appearances: flips + notedNow, ready: key !== null };
}
