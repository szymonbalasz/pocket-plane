// Shell state: the stored windows of the current layout key, plus restore and write rules
// (FR-SHELL-15/16). One per play page; survives waiting / reconnect screens.
import { createStore, type StoreApi } from "zustand";
import type { Rect, Viewport } from "./geometry";
import {
  type Placed,
  placedAs,
  reduce,
  restoreLayout,
  serialise,
  type WindowAction,
  type Windows,
  windowId,
} from "./manager";
import type { WindowRegistry } from "./registry";
import type { LayoutStorage } from "./storage";

export interface ShellState {
  /** Layout key the windows belong to; null before the first snapshot. */
  key: string | null;
  windows: Windows;
  /** How each window's current rect was chosen (`data-placed`); client memory only. */
  placed: ReadonlyMap<string, Placed>;
}

export interface ShellController {
  store: StoreApi<ShellState>;
  registry: WindowRegistry;
  /**
   * Apply the stored entry for `key` (first snapshot after load, or after `you.campaignId`
   * changes). Same key → no-op: other snapshots never open, close or move windows.
   */
  restore(key: string): void;
  /** Apply a user change; writes synchronously to the key it was made under. */
  dispatch(action: WindowAction, available: ReadonlySet<string>): void;
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * `placed` after a change: a move / resize end → `stored`; a rect the reducer chose (new
 * window, auto placement, reset) → `default` / `auto`; any other window keeps its value.
 */
function nextPlaced(
  prev: ShellState,
  next: Windows,
  action: WindowAction,
  registry: WindowRegistry,
  vp: Viewport,
): ReadonlyMap<string, Placed> {
  const out = new Map<string, Placed>();
  for (const w of next) {
    const id = windowId(w.kind, w.instance);
    const before = prev.windows.find((p) => p.kind === w.kind && p.instance === w.instance);
    const def = registry.get(w.kind);
    const moved = action.type === "reset" || !before || !sameRect(before, w);
    if (action.type === "setRect" && moved) out.set(id, "stored");
    else if (moved && def) out.set(id, placedAs(def, w, vp));
    else {
      const kept = prev.placed.get(id);
      if (kept) out.set(id, kept);
    }
  }
  return out;
}

export function createShellController(opts: {
  registry: WindowRegistry;
  storage: LayoutStorage;
  viewport: () => Viewport;
  /** On-screen map token boxes auto placement covers the least of (FR-SHELL-40). */
  avoid?: () => readonly Rect[];
  /** Measured content heights of growing windows (FR-SHELL-39): placement never goes below them. */
  heights?: (id: string) => number | undefined;
  warn?: (msg: string) => void;
}): ShellController {
  const { registry, storage } = opts;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const store = createStore<ShellState>()(() => ({ key: null, windows: [], placed: new Map() }));
  return {
    store,
    registry,
    restore(key) {
      if (store.getState().key === key) return;
      const vp = opts.viewport();
      const r = restoreLayout(registry, storage.read(key), vp, opts.avoid?.() ?? []);
      if (r.warning) warn(`play-shell: ${r.warning}; using the default layout`);
      const placed = new Map<string, Placed>();
      for (const w of r.windows) {
        const def = registry.get(w.kind);
        const how = r.stored || !def ? "stored" : placedAs(def, w, vp);
        placed.set(windowId(w.kind, w.instance), how);
      }
      store.setState({ key, windows: r.windows, placed });
    },
    dispatch(action, available) {
      const state = store.getState();
      const { key, windows } = state;
      if (key === null) return; // nothing shown before the first snapshot
      const viewport = opts.viewport();
      const next = reduce(windows, action, {
        registry,
        viewport,
        available,
        avoid: opts.avoid,
        heights: opts.heights,
        placed: (id) => state.placed.get(id),
      });
      if (next === windows) return;
      store.setState({
        windows: next,
        placed: nextPlaced(state, next, action, registry, viewport),
      });
      storage.write(key, serialise(next, registry));
    },
  };
}
