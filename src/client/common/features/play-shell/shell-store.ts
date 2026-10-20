// Shell state: the stored windows of the current layout key, plus restore and write rules
// (FR-SHELL-15/16). One per play page; survives waiting / reconnect screens.
import { createStore, type StoreApi } from "zustand";
import type { Rect, Viewport } from "./geometry";
import { hardRects, type KeepOut, keepOuts } from "./keep-outs";
import {
  isLayoutAction,
  isUserReopen,
  type Placed,
  placedAs,
  reduce,
  restoreLayout,
  serialise,
  type WindowAction,
  type Windows,
  windowId,
} from "./manager";
import { type PlacementToken, pcClear } from "./placement";
import type { WindowRegistry } from "./registry";
import type { LayoutStorage } from "./storage";

export interface ShellState {
  /** Layout key the windows belong to; null before the first snapshot. */
  key: string | null;
  windows: Windows;
  /** How each window's current rect was chosen (`data-placed`); client memory only. */
  placed: ReadonlyMap<string, Placed>;
  /**
   * Windows a feature open, appearance or auto placement just placed, waiting for their first
   * layout to `settle` (FR-SHELL-40, -41); client memory only.
   */
  settling: ReadonlySet<string>;
  /**
   * Windows auto-minimised to make room (FR-SHELL-47, `data-auto-minimised`) until restored or
   * closed; client memory only (a reload loads them plain `minimised`).
   */
  autoMinimised: ReadonlySet<string>;
  /**
   * Windows whose rect auto placement chose (`default`, `auto`, `reopened`) with no PC footprint
   * (+ 4 px) under it then (`data-pc-clear`, FR-SHELL-57); client memory only.
   */
  pcClear: ReadonlySet<string>;
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
 * `placed` after a change: a move / resize end → `stored`; a push off a tool bar → `pushed`
 * (FR-SHELL-55); a user reopen (FR-SHELL-56) → `reopened` when it moved the window, else
 * `stored`, and any other window it moved (off a protected one) → `auto`; a rect the reducer
 * chose (new window, auto placement, reset, viewport follow) → `default` / `auto`; any other
 * window keeps its value.
 */
function nextPlaced(
  prev: ShellState,
  next: Windows,
  action: WindowAction,
  registry: WindowRegistry,
  vp: Viewport,
  hard: readonly Rect[],
): ReadonlyMap<string, Placed> {
  const out = new Map<string, Placed>();
  for (const w of next) {
    const id = windowId(w.kind, w.instance);
    const before = prev.windows.find((p) => p.kind === w.kind && p.instance === w.instance);
    const def = registry.get(w.kind);
    const moved = action.type === "reset" || !before || !sameRect(before, w);
    const named = !isLayoutAction(action) && id === windowId(action.kind, action.instance);
    const reopen = named && isUserReopen(action, before?.state);
    if (reopen) out.set(id, moved ? "reopened" : "stored");
    else if (moved && !named && (action.type === "open" || action.type === "toggle")) {
      out.set(id, "auto");
    } else if (action.type === "setRect" && moved) out.set(id, "stored");
    else if (action.type === "push" && moved) out.set(id, "pushed");
    else if (moved && def) out.set(id, placedAs(def, w, vp, hard));
    else {
      const kept = prev.placed.get(id);
      if (kept) out.set(id, kept);
    }
  }
  return out;
}

/**
 * `settling` after a change: an `open` / `appear` that placed a window (new, or moved) adds it;
 * its `settle`, or a move / resize end, removes it.
 */
function nextSettling(
  prev: ReadonlySet<string>,
  before: Windows,
  next: Windows,
  action: WindowAction,
): ReadonlySet<string> {
  if (isLayoutAction(action)) return prev;
  const id = windowId(action.kind, action.instance);
  const without = () => {
    if (!prev.has(id)) return prev;
    const out = new Set(prev);
    out.delete(id);
    return out;
  };
  if (action.type === "settle" || action.type === "setRect") return without();
  if (action.type !== "open" && action.type !== "appear") return prev;
  const at = (ws: Windows) => ws.find((w) => windowId(w.kind, w.instance) === id);
  const w = at(next);
  const b = at(before);
  if (!w || (b && sameRect(b, w)) || prev.has(id)) return prev;
  return new Set(prev).add(id);
}

/**
 * `autoMinimised` after a change: a window the change minimised that the action didn't name (it
 * made room, FR-SHELL-47) is added; one no longer minimised is dropped.
 */
function nextAutoMinimised(
  prev: ReadonlySet<string>,
  before: Windows,
  next: Windows,
  action: WindowAction,
): ReadonlySet<string> {
  const named = isLayoutAction(action) ? null : windowId(action.kind, action.instance);
  const out = new Set<string>();
  for (const w of next) {
    if (w.state !== "minimised") continue;
    const id = windowId(w.kind, w.instance);
    const b = before.find((p) => p.kind === w.kind && p.instance === w.instance);
    if (prev.has(id) || (b?.state === "open" && id !== named)) out.add(id);
  }
  return out.size === prev.size && [...out].every((id) => prev.has(id)) ? prev : out;
}

/**
 * `pcClear` after a change: windows the change auto-placed (`placed` now `default`, `auto` or
 * `reopened` and moved) are tested against the PC footprints now; any other window that moved
 * drops out; the rest keep their mark.
 */
function nextPcClear(
  prev: ShellState,
  next: Windows,
  placed: ReadonlyMap<string, Placed>,
  tokens: () => readonly PlacementToken[],
): ReadonlySet<string> {
  const out = new Set<string>();
  let pcs: readonly PlacementToken[] | null = null;
  for (const w of next) {
    const id = windowId(w.kind, w.instance);
    const before = prev.windows.find((p) => p.kind === w.kind && p.instance === w.instance);
    const how = placed.get(id);
    if (before && sameRect(before, w)) {
      if (prev.pcClear.has(id)) out.add(id);
      continue;
    }
    if (how !== "default" && how !== "auto" && how !== "reopened") continue;
    pcs ??= tokens();
    if (pcClear(w, pcs)) out.add(id);
  }
  return out.size === prev.pcClear.size && [...out].every((id) => prev.pcClear.has(id))
    ? prev.pcClear
    : out;
}

export function createShellController(opts: {
  registry: WindowRegistry;
  storage: LayoutStorage;
  viewport: () => Viewport;
  /** On-screen map token boxes auto placement covers the least of (FR-SHELL-40, -45). */
  avoid?: () => readonly PlacementToken[];
  /** This client's keep-out regions (FR-SHELL-48); default `keepOuts(client, viewport)`. */
  keepOuts?: (vp: Viewport) => readonly KeepOut[];
  /** Measured content heights of growing windows (FR-SHELL-39): placement never goes below them. */
  heights?: (id: string) => number | undefined;
  warn?: (msg: string) => void;
}): ShellController {
  const { registry, storage } = opts;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const store = createStore<ShellState>()(() => ({
    key: null,
    windows: [],
    placed: new Map(),
    settling: new Set(),
    autoMinimised: new Set(),
    pcClear: new Set(),
  }));
  const regionsAt = (vp: Viewport) => opts.keepOuts?.(vp) ?? keepOuts(registry.client, vp);
  return {
    store,
    registry,
    restore(key) {
      if (store.getState().key === key) return;
      const vp = opts.viewport();
      const regions = regionsAt(vp);
      const r = restoreLayout(registry, storage.read(key), vp, opts.avoid?.() ?? [], regions);
      if (r.warning) warn(`play-shell: ${r.warning}; using the default layout`);
      const placed = new Map<string, Placed>();
      for (const w of r.windows) {
        const def = registry.get(w.kind);
        const how = r.stored || !def ? "stored" : placedAs(def, w, vp, hardRects(regions));
        placed.set(windowId(w.kind, w.instance), how);
      }
      const pcs = opts.avoid?.() ?? [];
      const pcClearNow = new Set(
        r.windows
          .filter((w) => placed.get(windowId(w.kind, w.instance)) !== "stored" && pcClear(w, pcs))
          .map((w) => windowId(w.kind, w.instance)),
      );
      store.setState({
        key,
        windows: r.windows,
        placed,
        settling: new Set(),
        autoMinimised: new Set(),
        pcClear: pcClearNow,
      });
      // FR-SHELL-53: default-sized windows took this viewport's default; written with `area`.
      if (r.migrated) storage.write(key, serialise(r.windows, registry));
    },
    dispatch(action, available) {
      const state = store.getState();
      const { key, windows } = state;
      if (key === null) return; // nothing shown before the first snapshot
      // One settle per placement (FR-SHELL-40): later layouts never move it again.
      if (action.type === "settle" && !state.settling.has(windowId(action.kind, action.instance))) {
        return;
      }
      const viewport = opts.viewport();
      const regions = regionsAt(viewport);
      const next = reduce(windows, action, {
        registry,
        viewport,
        available,
        avoid: opts.avoid,
        keepOuts: () => regions,
        heights: opts.heights,
        placed: (id) => state.placed.get(id),
      });
      const settling = nextSettling(state.settling, windows, next, action);
      if (next === windows) {
        if (settling !== state.settling) store.setState({ settling });
        return;
      }
      const placed = nextPlaced(state, next, action, registry, viewport, hardRects(regions));
      store.setState({
        windows: next,
        placed,
        pcClear: nextPcClear(state, next, placed, () => opts.avoid?.() ?? []),
        settling,
        autoMinimised: nextAutoMinimised(state.autoMinimised, windows, next, action),
      });
      storage.write(key, serialise(next, registry));
    },
  };
}
