// Free area (FR-SHELL-34, R1): the largest part of the work area, right of the tool rail, that no
// rendered open window covers, plus a counter of window *appearances* (a window rendered because
// its kind became available while open, or a feature-driven open noted by `noteAppearance()`)
// and of Fit requests (`requestFit()`, FR-SHELL-80). The map frames its tokens there (FR-MAP-44).
// Read-only: nothing stored or sent.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { contentHeights, useContentHeights } from "./content-heights";
import {
  type Rect,
  renderedRect,
  TOP_BAR_H,
  type Viewport,
  windowRects,
  workArea,
} from "./geometry";
import { useViewport } from "./hooks";
import { hardRects, type KeepOut, keepOuts, TOASTS_KEEP_OUT, useKeepOuts } from "./keep-outs";
import { type Windows, windowId } from "./manager";
import { RAIL_CLEAR } from "./placement";
import type { ShellClient, WindowRegistry } from "./registry";
import { useAvailableKinds, useRegistry, useShellState } from "./ShellContext";
import { shownStack, shownStacks, subscribeShownStack, summaryStrip } from "./toast-region";

/** Below this size (or share of the work area) the free area falls back to the work area. */
export const FREE_MIN_W = 320;
export const FREE_MIN_H = 240;
export const FREE_MIN_SHARE = 0.25;

/** The work area right of the tool rail, in viewport px. */
export function railArea(vp: Viewport): Rect {
  const wa = workArea(vp);
  return { x: RAIL_CLEAR, y: TOP_BAR_H, w: Math.max(1, wa.w - RAIL_CLEAR), h: wa.h };
}

export { contentHeights, reportContentHeight, useContentHeights } from "./content-heights";

/**
 * What each rendered window covers: open, available, fitted and clamped as `ShellWindow` draws it,
 * a `growToContent` window at its measured grown height (FR-SHELL-39), capped by the next window
 * or hard keep-out region (`hard`, default this client's; FR-SHELL-52). Every consumer of window
 * rects (free area, toast keep-out, attack popup) reads them here.
 */
export function renderedWindowRects(
  windows: Windows,
  registry: WindowRegistry,
  available: ReadonlySet<string>,
  vp: Viewport,
  measured: ReadonlyMap<string, number> = contentHeights(),
  hard: readonly Rect[] = hardRects(keepOuts(registry.client, vp)),
): Rect[] {
  const items = windows.flatMap((w) => {
    const def = registry.get(w.kind);
    if (!def || w.state !== "open" || !available.has(w.kind)) return [];
    return [{ win: w, def, needed: measured.get(windowId(w.kind, w.instance)) }];
  });
  return windowRects(items, vp, hard);
}

/**
 * What caps the growth of window `id` (FR-SHELL-52): the other rendered windows (fitted, not
 * grown) and this client's hard keep-out regions. For `ShellWindow`.
 */
export function useGrowthCaps(id: string): Rect[] {
  const registry = useRegistry();
  const windows = useShellState((s) => s.windows);
  const available = useAvailableKinds();
  const vp = useViewport();
  const regions = useKeepOuts(registry.client);
  return useMemo(() => {
    const out = hardRects(regions);
    for (const w of windows) {
      const def = registry.get(w.kind);
      if (!def || w.state !== "open" || !available.has(w.kind)) continue;
      if (windowId(w.kind, w.instance) !== id) out.push(renderedRect(w, def.minSize, vp));
    }
    return out;
  }, [registry, windows, available, vp, regions, id]);
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

/**
 * What the fit avoids (FR-MAP-59, -80): the rendered windows plus, for players, their toast box
 * (FR-SHELL-48 (a)); for the DM the summary strip (always) and the shown stack (FR-SHELL-59: what
 * shows at fit time), not the empty top-centre box (OQ-MAP-57 D, #288). Reported chrome (tool
 * bars) doesn't count: tool bars come and go, and the camera never refits on a tool change.
 */
export function fitObstacles(
  client: ShellClient,
  windows: readonly Rect[],
  regions: readonly KeepOut[],
  vp: Viewport,
  shown: Rect | null = shownStack(client),
): Rect[] {
  if (client === "dm") return [...windows, summaryStrip(vp), ...(shown ? [shown] : [])];
  return [...windows, ...regions.filter((k) => k.id === TOASTS_KEEP_OUT).map((k) => k.rect)];
}

/** At most this many candidate rectangles (FR-SHELL-44). */
export const FREE_AREAS_MAX = 16;

/**
 * Candidate free rectangles (FR-SHELL-44): every maximal axis-aligned rectangle of the work area
 * right of the rail that none of `rects` overlaps, each ≥ 320×240; largest first (ties → the
 * higher, then the more left), at most 16. The camera picks the one its tokens fit (FR-MAP-58).
 */
export function freeAreas(rects: readonly Rect[], vp: Viewport): Rect[] {
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
  const xs = [...new Set([bounds.x, bx1, ...obstacles.flatMap((o) => [o.x, o.x + o.w])])].sort(
    (a, b) => a - b,
  );
  const ys = [...new Set([bounds.y, by1, ...obstacles.flatMap((o) => [o.y, o.y + o.h])])].sort(
    (a, b) => a - b,
  );
  const empty = (x0: number, y0: number, x1: number, y1: number) =>
    !obstacles.some((o) => o.x < x1 && x0 < o.x + o.w && o.y < y1 && y0 < o.y + o.h);
  // A maximal empty rectangle has every side on the bounds or an obstacle edge, and can't grow
  // to the next grid line on any side.
  const out: Rect[] = [];
  for (let i = 0; i < ys.length; i++) {
    for (let j = i + 1; j < ys.length; j++) {
      const y0 = ys[i] as number;
      const y1 = ys[j] as number;
      if (y1 - y0 < FREE_MIN_H) continue;
      for (let k = 0; k < xs.length; k++) {
        for (let l = k + 1; l < xs.length; l++) {
          const x0 = xs[k] as number;
          const x1 = xs[l] as number;
          if (!empty(x0, y0, x1, y1)) break; // wider ones from this left edge only hit more
          if (x1 - x0 < FREE_MIN_W) continue;
          const maximal =
            (k === 0 || !empty(xs[k - 1] as number, y0, x1, y1)) &&
            (l === xs.length - 1 || !empty(x0, y0, xs[l + 1] as number, y1)) &&
            (i === 0 || !empty(x0, ys[i - 1] as number, x1, y1)) &&
            (j === ys.length - 1 || !empty(x0, y0, x1, ys[j + 1] as number));
          if (maximal) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
      }
    }
  }
  out.sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y || a.x - b.x);
  return out.slice(0, FREE_AREAS_MAX);
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

// ---- fit requests ----

let fits = 0;
const fitListeners = new Set<() => void>();

/**
 * Reset layout was applied on this page (FR-SHELL-80): the map runs one Fit (FR-MAP-45) with the
 * windows as they now are, so tokens move out from under the windows. Counts one request.
 */
export function requestFit(): void {
  fits += 1;
  for (const fn of [...fitListeners]) fn();
}

/** Fit requests so far on this page (tests, `useFreeArea`). */
export function fitRequests(): number {
  return fits;
}

const subscribeFits = (fn: () => void) => {
  fitListeners.add(fn);
  return () => {
    fitListeners.delete(fn);
  };
};

export interface FreeAreaState {
  /** Free area in viewport px (the canvas fills the viewport). */
  area: Rect;
  /** Every candidate free rectangle, largest first (FR-SHELL-44); may be empty. */
  areas: readonly Rect[];
  /**
   * The same, also clear of the fit's toast obstacles (`fitObstacles`: players' toast box, the
   * DM's summary strip + shown stack): the fit that keeps every token out from under the toasts
   * (FR-MAP-59, -80) picks from these.
   */
  toastFreeAreas: readonly Rect[];
  /** The fit's obstacles now (`fitObstacles`), screen px. */
  obstacles: readonly Rect[];
  /**
   * FR-MAP-91: the same room with the DM's shown stack left out (only the summary strip); the Fit
   * takes it when keeping the shown card toasts clear costs more than a quarter of the cell size.
   * Players: `toastFreeAreas` and `obstacles` as they are.
   */
  stripOnly: { areas: readonly Rect[]; obstacles: readonly Rect[] };
  /** Grows by one per appearance; compare with a previous value, never read as a total. */
  appearances: number;
  /** Grows by one per `requestFit` (FR-SHELL-80); compare with a previous value. */
  fitRequests: number;
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
  const regions = useKeepOuts(registry.client);
  const reports = useSyncExternalStore(subscribeShownStack, shownStacks, shownStacks);
  const { area, areas, toastFreeAreas, obstacles, stripOnly } = useMemo(() => {
    const shown = renderedWindowRects(
      windows,
      registry,
      available,
      vp,
      measured,
      hardRects(regions),
    );
    const client = registry.client;
    const obstacles = fitObstacles(client, shown, regions, vp, shownStack(client, reports));
    const toastFreeAreas = freeAreas(obstacles, vp);
    const strip = fitObstacles(client, shown, regions, vp, null);
    return {
      area: freeArea(shown, vp),
      areas: freeAreas(shown, vp),
      toastFreeAreas,
      obstacles,
      stripOnly:
        strip.length === obstacles.length
          ? { areas: toastFreeAreas, obstacles }
          : { areas: freeAreas(strip, vp), obstacles: strip },
    };
  }, [windows, registry, available, vp, measured, regions, reports]);
  const notedNow = useSyncExternalStore(subscribeNoted, notedAppearances);
  const fitsNow = useSyncExternalStore(subscribeFits, fitRequests);
  const [flips, setFlips] = useState(0);
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const seen = useRef<AvailabilitySeen | null>(null);
  useEffect(() => {
    const next = { key, kinds: available };
    if (isAppearance(seen.current, next, windowsRef.current)) setFlips((n) => n + 1);
    seen.current = next;
  }, [key, available]);
  return {
    area,
    areas,
    toastFreeAreas,
    obstacles,
    stripOnly,
    appearances: flips + notedNow,
    fitRequests: fitsNow,
    ready: key !== null,
  };
}
