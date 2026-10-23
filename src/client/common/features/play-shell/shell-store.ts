// Shell state: the stored windows of the current layout key, plus restore and write rules
// (FR-SHELL-15/16), and the placer's client memory (FR-SHELL-102, -110). One per play page;
// survives waiting / reconnect screens.

import type { You } from "@shared/protocol/frames";
import { createStore, type StoreApi } from "zustand";
import { isRemembered, type Rect, type Viewport } from "./geometry";
import { hardRects, type KeepOut, keepOuts } from "./keep-outs";
import {
  type Displacement,
  type DryFit,
  isLayoutAction,
  isReopenCovered,
  isUserReopen,
  type ManagerContext,
  type Placed,
  placedAs,
  plan,
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
   * Windows put away to make room (FR-SHELL-47, `data-auto-minimised`) until restored or closed;
   * client memory only (a reload loads them plain `minimised`).
   */
  autoMinimised: ReadonlySet<string>;
  /**
   * The kind each auto-minimised window made room for (FR-SHELL-77, -88:
   * `data-auto-minimised-for`), while it stays minimised; client memory only.
   */
  autoMinimisedFor: ReadonlyMap<string, string>;
  /**
   * Why each auto-minimised window was put away (FR-SHELL-110 `data-auto-minimised-cause`):
   * `toolbar:<id>`, `viewport:<w>×<h>`, `window:<kind>` (it returns when that ends) or
   * `open:<kind>`.
   */
  autoMinimisedCause: ReadonlyMap<string, string>;
  /**
   * The last placement's auto-minimise moves, "parked>for;…" (FR-SHELL-88, `ui-play-page`
   * `data-auto-minimise-log`); client memory only.
   */
  autoMinimiseLog: string;
  /** The last settle's steps, "trigger:kind>rung;…" (FR-SHELL-110 `data-settle-log`). */
  settleLog: string;
  /**
   * Displacement memory (FR-SHELL-102): what a transient cause moved, shrank or put away, until
   * the cause ends or the user moves, resizes, closes or minimises it; dropped on reload and
   * reset. Client memory only.
   */
  memory: readonly Displacement[];
  /**
   * Windows the placer placed with no PC footprint (+ 4 px) under them (`data-pc-clear`,
   * FR-SHELL-57); one placed at `L5` is absent. Client memory only.
   */
  pcClear: ReadonlySet<string>;
  /** The viewport the layout was last settled at (FR-SHELL-95 `viewport`, -103). */
  settledAt: Viewport | null;
  /**
   * `viewport` settles applied on this page so far (FR-MAP-113: a resize refit waits for the
   * settle of its own resize, not an older one at the same size). Client memory only.
   */
  viewportSettles: number;
}

export interface ShellController {
  store: StoreApi<ShellState>;
  registry: WindowRegistry;
  /**
   * Apply the stored entry for `key` (first snapshot after load, or after `you.campaignId`
   * changes): the placer's `load` settle. Same key → no-op: other snapshots never open, close or
   * move windows.
   */
  restore(key: string): void;
  /** Apply a user change; writes synchronously to the key it was made under. */
  dispatch(action: WindowAction, available: ReadonlySet<string>): void;
  /**
   * A `blocksInput` overlay is up (FR-SHELL-112 (2)): actions queue (one per window and kind of
   * action, the last kept) and run, in order, when it goes.
   */
  setBlocked(blocked: boolean): void;
  /**
   * Re-tests `data-pc-clear` of the windows the shell placed against the PCs as drawn now, rects
   * unchanged (after the map's Fit that follows Reset layout, FR-SHELL-80).
   */
  refreshPcClear(): void;
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * `placed` after a change: what the placer placed (its plan); a move / resize end → `stored` (or
 * `pushed` off a tool bar, FR-SHELL-105); a user reopen (FR-SHELL-56) → `reopened` when its
 * stored rect was `covered` (re-placed), else `stored`; any other window keeps its value.
 */
function nextPlaced(
  prev: ShellState,
  next: Windows,
  action: WindowAction,
  planned: ReadonlyMap<string, Placed>,
  covered: boolean,
): ReadonlyMap<string, Placed> {
  const out = new Map<string, Placed>();
  for (const w of next) {
    const id = windowId(w.kind, w.instance);
    const before = prev.windows.find((p) => p.kind === w.kind && p.instance === w.instance);
    const named = !isLayoutAction(action) && id === windowId(action.kind, action.instance);
    const how = planned.get(id);
    // A move / resize end dropped over a shown tool bar is pushed off it (FR-SHELL-105).
    if (named && action.type === "setRect") out.set(id, how ?? "stored");
    else if (named && isUserReopen(action, before?.state) && !how) {
      out.set(id, covered ? "reopened" : "stored");
    } else if (how) out.set(id, how);
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
  // A feature open placed it even when the rect it chose is the one it had (the placer may put
  // others away instead of moving it).
  const featureOpen =
    action.type === "open" && action.by === "feature" && b !== undefined && b.state !== "open";
  // A remembered window opens at its stored rect: nothing to settle (FR-SHELL-146).
  if (!w || isRemembered(w) || (b && sameRect(b, w) && !featureOpen) || prev.has(id)) return prev;
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

/** Keeps `map`'s entries whose window is still auto-minimised; adds `moves`. */
function nextFor(
  prev: ReadonlyMap<string, string>,
  auto: ReadonlySet<string>,
  moves: ReadonlyMap<string, string>,
  fallback: string | null,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const id of auto) {
    const v = moves.get(id) ?? prev.get(id) ?? fallback;
    if (v) out.set(id, v);
  }
  return out.size === prev.size && [...out].every(([k, v]) => prev.get(k) === v) ? prev : out;
}

/**
 * `pcClear` after a change: the windows the placer placed take its flag; any other window that
 * moved drops out; the rest keep their mark.
 */
function nextPcClear(
  prev: ShellState,
  next: Windows,
  flags: ReadonlyMap<string, boolean>,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const w of next) {
    const id = windowId(w.kind, w.instance);
    const flag = flags.get(id);
    if (flag !== undefined) {
      if (flag) out.add(id);
      continue;
    }
    const before = prev.windows.find((p) => p.kind === w.kind && p.instance === w.instance);
    if (before && sameRect(before, w) && prev.pcClear.has(id)) out.add(id);
  }
  return out.size === prev.pcClear.size && [...out].every((id) => prev.pcClear.has(id))
    ? prev.pcClear
    : out;
}

/** Actions that run an auto placement (the auto-minimise log restarts with each). */
const placing = (a: WindowAction) =>
  a.type === "open" || a.type === "toggle" || a.type === "appear" || a.type === "settle";

export function createShellController(opts: {
  registry: WindowRegistry;
  storage: LayoutStorage;
  viewport: () => Viewport;
  /** On-screen map token footprints (FR-SHELL-57, -96): `pc` = a player character. */
  avoid?: () => readonly PlacementToken[];
  /** This client's keep-out regions (FR-SHELL-48, -113); default `keepOuts(client, viewport)`. */
  keepOuts?: (vp: Viewport) => readonly KeepOut[];
  /** Measured content heights of growing windows (FR-SHELL-39): placement never goes below them. */
  heights?: (id: string) => number | undefined;
  /** Kinds available when a layout is applied (default: every registered kind). */
  available?: () => ReadonlySet<string>;
  /** The camera mode now (FR-SHELL-99); default `fitted`. */
  camera?: () => "fitted" | "moved";
  /** The canvas's base port for L2b (FR-SHELL-108); absent → the map never yields. */
  dryFit?: (obstacles: readonly Rect[]) => DryFit | null;
  /** The last full fit's cell px (FR-SHELL-108). */
  lastFullCell?: () => number | null;
  /** The placer accepted a yield (L2b): the map refits once (FR-MAP-97). */
  onYield?: () => void;
  /** A protected window went back to its zone over a PC (FR-MAP-114): one `window` refit. */
  onRefit?: () => void;
  /** Reset layout was applied (FR-SHELL-80): the page requests one Fit of the map. */
  onReset?: () => void;
  /** Who this page is, for `onAbsorb` (FR-SHELL-155). */
  you?: () => You | null;
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
    autoMinimisedFor: new Map(),
    autoMinimisedCause: new Map(),
    autoMinimiseLog: "",
    settleLog: "",
    memory: [],
    pcClear: new Set(),
    settledAt: null,
    viewportSettles: 0,
  }));
  const regionsAt = (vp: Viewport) => opts.keepOuts?.(vp) ?? keepOuts(registry.client, vp);
  const allKinds = () => new Set(registry.defs.map((d) => d.kind));
  let blocked = false;
  const queued = new Map<string, { action: WindowAction; available: ReadonlySet<string> }>();
  const queueKey = (a: WindowAction) =>
    isLayoutAction(a) ? a.type : `${a.type}:${windowId(a.kind, a.instance)}`;
  const contextFor = (
    state: ShellState,
    available: ReadonlySet<string>,
    moves: Map<string, string>,
  ): ManagerContext => {
    const viewport = opts.viewport();
    const regions = regionsAt(viewport);
    return {
      registry,
      viewport,
      available,
      avoid: opts.avoid,
      keepOuts: () => regions,
      heights: opts.heights,
      placed: (id) => state.placed.get(id),
      memory: () => state.memory,
      camera: opts.camera,
      dryFit: opts.dryFit,
      lastFullCell: opts.lastFullCell,
      settledViewport: state.settledAt ?? viewport,
      onAutoMinimise: (id, forKind) => moves.set(id, forKind),
      autoMinimised: () => state.autoMinimised,
    };
  };
  const ctl: ShellController = {
    store,
    registry,
    restore(key) {
      if (store.getState().key === key) return;
      const vp = opts.viewport();
      const regions = regionsAt(vp);
      const tokens = opts.avoid?.() ?? [];
      const moves = new Map<string, string>();
      const base = store.getState();
      const ctx = contextFor(
        { ...base, memory: [], placed: new Map(), settledAt: vp },
        opts.available?.() ?? allKinds(),
        moves,
      );
      const r = restoreLayout(registry, storage.read(key), vp, tokens, regions, ctx);
      if (r.warning) warn(`play-shell: ${r.warning}; using the default layout`);
      const placed = new Map<string, Placed>();
      const hard = hardRects(regions);
      for (const w of r.windows) {
        const def = registry.get(w.kind);
        const how = r.stored || !def ? "stored" : placedAs(def, w, vp, hard);
        placed.set(
          windowId(w.kind, w.instance),
          def?.defaultOpen && !isRemembered(w) ? "zone" : how,
        );
      }
      const pcClearNow = new Set(
        r.windows
          .filter(
            (w) => placed.get(windowId(w.kind, w.instance)) !== "stored" && pcClear(w, tokens),
          )
          .map((w) => windowId(w.kind, w.instance)),
      );
      store.setState({
        key,
        windows: r.windows,
        placed,
        settling: new Set(),
        autoMinimised: new Set(),
        autoMinimisedFor: new Map(),
        autoMinimisedCause: new Map(),
        autoMinimiseLog: "",
        settleLog: "",
        memory: [],
        pcClear: pcClearNow,
        settledAt: vp,
      });
      // The load settle changed the entry (zones, FR-SHELL-53's default sizes, an absorbed
      // entry, FR-SHELL-155): written.
      if (r.migrated) storage.write(key, serialise(r.windows, registry));
      for (const a of r.absorbed ?? [])
        registry.get(a.kind)?.onAbsorb?.(a.from, opts.you?.() ?? null);
    },
    refreshPcClear() {
      const state = store.getState();
      const tokens = opts.avoid?.() ?? [];
      const mine = (how: Placed | undefined) => how !== undefined && how !== "stored";
      const next = new Set(
        state.windows
          .filter((w) => w.state === "open")
          .map((w) => windowId(w.kind, w.instance))
          .filter((id) => mine(state.placed.get(id))),
      );
      for (const w of state.windows) {
        const id = windowId(w.kind, w.instance);
        if (next.has(id) && !pcClear(w, tokens)) next.delete(id);
      }
      const same =
        next.size === state.pcClear.size && [...next].every((id) => state.pcClear.has(id));
      if (!same) store.setState({ pcClear: next });
    },
    setBlocked(next) {
      if (blocked === next) return;
      blocked = next;
      if (blocked) return;
      const run = [...queued.values()];
      queued.clear();
      for (const q of run) ctl.dispatch(q.action, q.available);
    },
    dispatch(action, available) {
      if (blocked) {
        const k = queueKey(action);
        queued.delete(k);
        queued.set(k, { action, available });
        return;
      }
      const state = store.getState();
      const { key, windows } = state;
      if (key === null) return; // nothing shown before the first snapshot
      // One settle per placement (FR-SHELL-40): later layouts never move it again.
      if (action.type === "settle" && !state.settling.has(windowId(action.kind, action.instance))) {
        return;
      }
      const moves = new Map<string, string>();
      const ctx = contextFor(state, available, moves);
      // FR-SHELL-56: whether a user reopen finds its stored rect covered (`data-placed`).
      const named = isLayoutAction(action)
        ? undefined
        : windows.find(
            (w) => windowId(w.kind, w.instance) === windowId(action.kind, action.instance),
          );
      const covered =
        named !== undefined &&
        isUserReopen(action, named.state) &&
        available.has(named.kind) &&
        isReopenCovered(windows, named, ctx);
      const p = plan(windows, action, ctx);
      const next = p.windows;
      const settling = nextSettling(state.settling, windows, next, action);
      const settledAt =
        action.type === "viewport" || action.type === "reset" ? ctx.viewport : state.settledAt;
      const viewportSettles = state.viewportSettles + (action.type === "viewport" ? 1 : 0);
      const log = p.log.length > 0 ? p.log.join(";") : state.settleLog;
      if (next === windows) {
        const patch: Partial<ShellState> = {};
        if (settling !== state.settling) patch.settling = settling;
        if (p.memory !== state.memory) patch.memory = p.memory;
        if (settledAt !== state.settledAt) patch.settledAt = settledAt;
        if (viewportSettles !== state.viewportSettles) patch.viewportSettles = viewportSettles;
        if (log !== state.settleLog) patch.settleLog = log;
        if (Object.keys(patch).length > 0) store.setState(patch);
        if (action.type === "reset") opts.onReset?.();
        return;
      }
      const placed = nextPlaced(state, next, action, p.placed, covered);
      const autoMinimised = nextAutoMinimised(state.autoMinimised, windows, next, action);
      const forKind = isLayoutAction(action) ? null : action.kind;
      const moveLog = [...moves].map(([id, k]) => `${id.split(":")[0]}>${k}`).join(";");
      store.setState({
        windows: next,
        placed,
        pcClear: nextPcClear(state, next, p.pcClear),
        settling,
        autoMinimised,
        autoMinimisedFor: nextFor(state.autoMinimisedFor, autoMinimised, moves, forKind),
        autoMinimisedCause: nextFor(
          state.autoMinimisedCause,
          autoMinimised,
          p.putAway,
          forKind && `open:${forKind}`,
        ),
        autoMinimiseLog: moves.size > 0 || placing(action) ? moveLog : state.autoMinimiseLog,
        settleLog: log,
        memory: action.type === "reset" ? [] : p.memory,
        settledAt,
        viewportSettles,
      });
      storage.write(key, serialise(next, registry));
      if (p.yields) opts.onYield?.();
      if (p.refit === "window") opts.onRefit?.();
      if (action.type === "reset") opts.onReset?.();
    },
  };
  return ctl;
}
