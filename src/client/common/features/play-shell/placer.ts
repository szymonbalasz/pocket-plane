// One placer (FR-SHELL-95–111, ADR-0060): `settle(windows, trigger, world)` is the only writer of
// window geometry and auto-minimising, besides a user's own move / resize. Pure, deterministic;
// it returns a plan the shell applies. `placeWindow` (placement.ts) stays the spot search.
//
// The ladder (FR-SHELL-97, #333 as read at #335), for a window a trigger must place; the first
// rung with an accepted spot wins (accepted = clear of windows and hard keep-outs, and of every
// PC footprint + 4 px), each rung at a 12-px gap, then retried at 4 px (FR-SHELL-98):
//   L1  the target size (a user size, else the fitted default);
//   L2  down to the useful size; then the protected squeeze (FR-SHELL-101, launcher windows only);
//   L2b players, `fitted` camera: the map yields (FR-SHELL-108, through the canvas's base port);
//   L3  the look-ahead with every launcher window put away helps → put away the least recently
//       used one (FR-SHELL-78) and restart;
//   L4  below useful, down to the min size (same look-ahead);
//   L5  the least PC area, flagged (`data-pc-clear` absent). A protected window is never put away.
// Zones (FR-SHELL-99, OQ-SHELL-63 A): a protected window takes its rect in this viewport's named
// default layout iff PC-clear, else the ladder among the protected windows (zone first); launcher
// windows in it are displaced. Displacement memory (FR-SHELL-102): what a transient cause moved,
// shrank or put away comes back when the cause ends.
// Window memory (FR-SHELL-144–152, ADR-0064, protocol §18): a window the user moved or resized
// (remembered) is never written here: it is a fixed obstacle for the ladder, never put away,
// squeezed, displaced or pushed (its tool-bar push and on-screen nudge are render-only); zones
// ignore it. The ladder above runs for untouched windows only.
import { MAIN_INSTANCE, type WindowState } from "@shared/play-shell/layout";
import {
  clampRect,
  EDGE_GAP,
  growsToContent,
  isRemembered,
  LAUNCHER_CLEAR,
  placedRect,
  type Rect,
  renderedRect,
  TOP_BAR_H,
  type Viewport,
  windowRects,
  workArea,
} from "./geometry";
import { hardRects, type KeepOut, keepOuts, TOASTS_KEEP_OUT } from "./keep-outs";
import {
  fittedDefaultRect,
  type Obstacle,
  type Placeable,
  type PlaceInput,
  type Placement,
  type PlacementToken,
  pcBoxes,
  pcClear,
  placeMemo,
  placeWindow,
  roomFor,
  usableArea,
} from "./placement";
import {
  defaultSizeAt,
  knownDefaultSizes,
  type Size,
  type WindowDef,
  type WindowRegistry,
} from "./registry";

export type Windows = readonly WindowState[];

/**
 * Who opens a window (FR-SHELL-08): `user` (a click; the default) reopens at the stored rect
 * unless something now covers it (FR-SHELL-56); `feature` (a feature on its own, e.g. Initiative
 * at Start) never lands on another window (FR-SHELL-41).
 */
export type OpenBy = "user" | "feature";

/**
 * How a window's current rect was chosen (`ui-window` `data-placed`; client memory only):
 * `default` / `auto` = a ladder spot (the fitted default rect / another), `stored` = read from the
 * entry, set or kept by the user, `pushed` = moved off a tool bar (FR-SHELL-55), `reopened` = a user
 * reopen found its rect covered (FR-SHELL-56), `returned` = back after its cause ended
 * (FR-SHELL-102), `zone` = a protected window at its zone (FR-SHELL-99), `displaced` = moved for a
 * transient cause, `grown` = grew back toward its target (FR-SHELL-103), `squeezed` = a protected
 * window shrunk to its useful size in its zone (FR-SHELL-101).
 */
export type Placed =
  | "auto"
  | "stored"
  | "default"
  | "pushed"
  | "reopened"
  | "returned"
  | "zone"
  | "displaced"
  | "grown"
  | "squeezed";

/**
 * A window the placer moved, shrank or put away for a transient cause (FR-SHELL-102), client
 * memory: its first prior stored rect, `userSpot`, `userSize`; `cause` = `toolbar:<id>`,
 * `viewport:<w>×<h>` or `window:<kind>`; `at` = the rect the displacement wrote (null: put away).
 */
export interface Displacement {
  kind: string;
  instance: string;
  rect: Rect;
  userSpot?: true;
  userSize?: true;
  cause: string;
  at: Rect | null;
}

/** L2b's dry fit (FR-SHELL-108, FR-MAP-97): the cell it would draw and whether it keeps clear. */
export interface DryFit {
  cellPx: number;
  /** Every PC, and every token the last fit kept clear, clear of the windows at that cell. */
  clear: boolean;
}

/** The world a settle sees (FR-SHELL-96), besides the windows. */
export interface ManagerContext {
  registry: WindowRegistry;
  viewport: Viewport;
  /** Kinds rendered right now (registered + available). */
  available: ReadonlySet<string>;
  /** On-screen token footprints, current camera; `pc` = a player character (#318). */
  avoid?: () => readonly PlacementToken[];
  /** This client's keep-out regions now (FR-SHELL-48, -113); default `keepOuts(client, vp)`. */
  keepOuts?: () => readonly KeepOut[];
  /** How a window's current rect was chosen, if known on this page (`data-placed`). */
  placed?: (id: string) => Placed | undefined;
  /** Measured content height of a `growToContent` window (FR-SHELL-39), by window id. */
  heights?: (id: string) => number | undefined;
  /** Displacement memory (FR-SHELL-102). */
  memory?: () => readonly Displacement[];
  /** The camera mode (FR-SHELL-99): with `moved`, a zone over a PC goes through the ladder. */
  camera?: () => "fitted" | "moved";
  /** The canvas's base port for L2b (FR-SHELL-108, players): a dry fit with these obstacles. */
  dryFit?: (obstacles: readonly Rect[]) => DryFit | null;
  /** The last full fit's cell, px (FR-SHELL-108: a yield keeps ≥ 75 % of it). */
  lastFullCell?: () => number | null;
  /** The viewport the layout was last settled at (`viewport` trigger, FR-SHELL-103). */
  settledViewport?: Viewport;
  /** Called for each window put away for `forKind` (FR-SHELL-77, -88). */
  onAutoMinimise?: (id: string, forKind: string) => void;
  /** Windows the shell put away, still minimised (`data-auto-minimised`, client memory). */
  autoMinimised?: () => ReadonlySet<string>;
}

/**
 * What makes the placer run (FR-SHELL-95). `load`: the layout applied (`drawn` false: no token
 * drawn yet) and once more after the first token draw (`drawn` true), so PCs count.
 */
export type Trigger =
  | { type: "load"; drawn: boolean }
  /** A window opened (`fresh`: it had no entry); `reopen` = a user open of a closed one. */
  | { type: "open"; kind: string; instance: string; by: OpenBy; fresh: boolean }
  | { type: "reopen"; kind: string; instance: string }
  | { type: "appear"; kind: string; instance: string }
  | { type: "settle"; kind: string; instance: string }
  | { type: "viewport" }
  | { type: "push"; rect: Rect }
  | { type: "return" }
  | { type: "drag-end"; kind: string; instance: string }
  | { type: "reset" };

/** A settle's outcome; the shell applies it (FR-SHELL-110). */
export interface Plan {
  windows: Windows;
  memory: readonly Displacement[];
  /** How each window this settle placed was placed. */
  placed: ReadonlyMap<string, Placed>;
  /** Windows this settle placed: PC-clear, or flagged `L5` (false). */
  pcClear: ReadonlyMap<string, boolean>;
  /** Windows this settle put away → the cause (`data-auto-minimised-cause`). */
  putAway: ReadonlyMap<string, string>;
  /** `trigger:kind>rung` entries (`data-settle-log`). */
  log: readonly string[];
  /** L2b accepted: the map refits once (`window`, FR-MAP-97). */
  yields: boolean;
  /**
   * FR-MAP-114: a squeezed protected window went back to its zone over a PC footprint + 4 with a
   * `fitted` camera: the map runs one `window` refit after this settle.
   */
  refit?: "window";
}

export const windowId = (kind: string, instance: string = MAIN_INSTANCE) => `${kind}:${instance}`;

const idOf = (w: { kind: string; instance: string }) => windowId(w.kind, w.instance);

export const sameRect = (a: Rect | null | undefined, b: Rect | null | undefined) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const plainRect = (r: Rect): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h });

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The context's keep-out regions. */
export const keepOutsOf = (ctx: Pick<ManagerContext, "keepOuts" | "registry" | "viewport">) =>
  ctx.keepOuts?.() ?? keepOuts(ctx.registry.client, ctx.viewport);

export const softRects = (list: readonly KeepOut[]) =>
  list.filter((k) => k.kind === "soft").map((k) => k.rect);

/**
 * The bars that push a remembered window, render-only (FR-SHELL-150): the shown hard keep-outs
 * (tool bar, chrome keep-outs), never the toast box.
 */
export const pushBars = (list: readonly KeepOut[]) =>
  list.filter((k) => k.kind === "hard" && k.id !== TOASTS_KEEP_OUT).map((k) => k.rect);

export const isShown = (w: WindowState, available: ReadonlySet<string>) =>
  w.state === "open" && available.has(w.kind);

export const find = (ws: Windows, kind: string, instance: string) =>
  ws.find((w) => w.kind === kind && w.instance === instance);

export const maxZ = (ws: Windows) => ws.reduce((m, w) => Math.max(m, w.z), 0);

/** Renumber z to 1..n in current order, so it stays small and bounded. */
export function normaliseZ(ws: WindowState[]): WindowState[] {
  const order = [...ws].sort((a, b) => a.z - b.z);
  const rank = new Map(order.map((w, i) => [w, i + 1]));
  return ws.map((w) => (w.z === rank.get(w) ? w : { ...w, z: rank.get(w) ?? w.z }));
}

/**
 * This client's default layout (FR-SHELL-14, -50): every `defaultOpen` type in registry order:
 * on token-free input its fitted default rect (FR-SHELL-51) wherever that is clear of the earlier
 * ones and the hard keep-outs; with `avoid` (tokens drawn) the rank decides. The named layouts
 * (1280×720 / ×800, 1440×900, 1600×900) are play-shell §7's table: the zones (FR-SHELL-99).
 */
export function defaultLayout(
  registry: WindowRegistry,
  vp: Viewport,
  avoid: readonly PlacementToken[] = [],
  regions: readonly KeepOut[] = keepOuts(registry.client, vp),
): WindowState[] {
  const hard = hardRects(regions);
  const soft = softRects(regions);
  const out: WindowState[] = [];
  for (const d of registry.defs) {
    if (!d.defaultOpen) continue;
    const windows = out.map((w) => ({ ...clampRect(w, vp), protected: true }));
    const { rect } = placeWindow(d, vp, { windows, hard, soft, tokens: avoid });
    out.push({
      kind: d.kind,
      instance: MAIN_INSTANCE,
      state: "open",
      ...rect,
      z: out.length + 1,
      area: workArea(vp),
    });
  }
  return out;
}

/** FR-SHELL-79: a window's useful height is at most this unless it declares more. */
export const USEFUL_H = 360;

const bands = new WeakMap<WindowRegistry, Map<string, number>>();

/**
 * FR-SHELL-79's **band**: the work area's height above the protected bottom window (the Game
 * log) in this client's token-free default layout at `vp` (DM 412 / 492 / 512 / 512, player
 * 412 / 492 / 472 / 472 at the reference sizes); the whole usable height without one.
 */
export function bandAt(registry: WindowRegistry, vp: Viewport): number {
  const key = `${vp.w}x${vp.h}`;
  let byVp = bands.get(registry);
  if (!byVp) {
    byVp = new Map();
    bands.set(registry, byVp);
  }
  const known = byVp.get(key);
  if (known !== undefined) return known;
  const a = usableArea(vp);
  let bottom = a.bottom;
  for (const w of defaultLayout(registry, vp, [], keepOuts(registry.client, vp, new Map()))) {
    if (registry.get(w.kind)?.defaultPosition.anchor.startsWith("bottom")) {
      bottom = Math.min(bottom, w.y - EDGE_GAP);
    }
  }
  const band = Math.max(0, bottom - a.top);
  byVp.set(key, band);
  return band;
}

/**
 * FR-SHELL-79, -100: `useful(def, vp, client)`: width `usefulSize.w` ?? the fitted default
 * width; height min(`usefulSize.h` ?? `minOpenH` ?? min(default h, 360), band); never below the
 * min size, never above the default.
 */
export function usefulSize(def: WindowDef, vp: Viewport, band: number): Size {
  const fitted = fittedDefaultRect(def, vp);
  const dflt = defaultSizeAt(def, vp);
  const w = Math.min(fitted.w, Math.max(def.minSize.w, def.usefulSize?.w ?? fitted.w));
  const want = def.usefulSize?.h ?? def.minOpenH ?? Math.min(dflt.h, USEFUL_H);
  const h = Math.min(dflt.h, Math.max(def.minSize.h, Math.min(want, band)));
  return { w, h };
}

/** `usefulSize` with this registry's band. */
export const useful = (def: WindowDef, vp: Viewport, registry: WindowRegistry) =>
  usefulSize(def, vp, bandAt(registry, vp));

/**
 * Rendered rects (fit + clamp + grown to content, growth capped by the others and the hard
 * keep-outs, FR-SHELL-52) of the windows on screen now, plus `extra` as if on screen; unknown
 * kinds clamp only.
 */
export function shownRects(ws: Windows, ctx: ManagerContext, extra?: WindowState) {
  const vp = ctx.viewport;
  const shown = ws.filter((w) => isShown(w, ctx.available));
  if (extra && !shown.includes(extra)) shown.push(extra);
  const out = new Map<WindowState, Rect>();
  const known = shown.flatMap((w) => {
    const def = ctx.registry.get(w.kind);
    if (!def) out.set(w, clampRect(w, vp));
    return def ? [{ win: w, def, needed: ctx.heights?.(idOf(w)) }] : [];
  });
  const regions = keepOutsOf(ctx);
  const rects = windowRects(known, vp, hardRects(regions), pushBars(regions));
  for (const [i, k] of known.entries()) out.set(k.win, rects[i] as Rect);
  return out;
}

/** Where a stored window renders now, among the windows on screen. */
export function shownRect(ws: Windows, w: WindowState, ctx: ManagerContext): Rect {
  return shownRects(ws, ctx, w).get(w) ?? clampRect(w, ctx.viewport);
}

/** Rendered rects of the windows on screen now, except (kind, instance); defaults protected. */
export function onScreen(
  ws: Windows,
  ctx: ManagerContext,
  kind: string,
  instance: string,
): Obstacle[] {
  const out: Obstacle[] = [];
  for (const [w, r] of shownRects(ws, ctx)) {
    if (w.kind === kind && w.instance === instance) continue;
    out.push({ ...r, protected: ctx.registry.get(w.kind)?.defaultOpen === true });
  }
  return out;
}

/** `default` when an auto-placed `r` is the type's fitted default rect, else `auto`. */
export function placedAs(def: Placeable, r: Rect, vp: Viewport, hard: readonly Rect[] = []) {
  return sameRect(fittedDefaultRect(def, vp, hard), r) ? "default" : "auto";
}

/**
 * A rect the shell chose for `w`, written with `area`; `userSpot` and `userSize` dropped (a shell
 * spot, FR-SHELL-56 note, FR-SHELL-100).
 */
export function shellRect(w: WindowState, r: Rect, area: WindowState["area"]): WindowState {
  const { userSpot: _spot, userSize: _size, ...rest } = w;
  return { ...rest, x: r.x, y: r.y, w: r.w, h: r.h, area };
}

/**
 * Covered (FR-SHELL-56 (2), OQ-SHELL-41 A): the window's shown rect overlaps, by ≥ 1 px, another
 * rendered open window or a hard keep-out region. The DM's soft box and tokens don't count.
 */
export function isCovered(ws: Windows, cur: WindowState, ctx: ManagerContext): boolean {
  const shown = shownRect(ws, cur, ctx);
  if (onScreen(ws, ctx, cur.kind, cur.instance).some((o) => overlaps(shown, o))) return true;
  return hardRects(keepOutsOf(ctx)).some((k) => overlaps(shown, k));
}

/**
 * A user reopen's "covered" (FR-SHELL-56 (2) with OQ-SHELL-55 B): `isCovered`, or, for a spot the
 * shell chose (no `userSpot`), its shown rect covers a PC footprint + 4 px.
 */
export function isReopenCovered(ws: Windows, cur: WindowState, ctx: ManagerContext): boolean {
  if (isCovered(ws, cur, ctx)) return true;
  return !cur.userSpot && !pcClear(shownRect(ws, cur, ctx), ctx.avoid?.() ?? []);
}

/**
 * Windows the ladder may put away for (kind, instance) (FR-SHELL-77, -78): rendered, open,
 * untouched (FR-SHELL-151), type neither `defaultOpen` nor `fixedDefault`, not the window placed; ascending z (least recently
 * brought to front first), ties → earlier in the entry, a window placed earlier in this settle's
 * own sequence (`late`) last.
 */
export function autoMinimiseOrder(
  ws: Windows,
  ctx: ManagerContext,
  kind: string,
  instance: string,
  late?: ReadonlySet<string>,
): WindowState[] {
  const at = new Map(ws.map((w, i) => [w, i]));
  const isLate = (w: WindowState) => (late?.has(idOf(w)) ? 1 : 0);
  return ws
    .filter((w) => {
      const d = ctx.registry.get(w.kind);
      if (!d || d.defaultOpen || d.fixedDefault || !isShown(w, ctx.available)) return false;
      // FR-SHELL-151: only untouched launcher windows are put away.
      if (isRemembered(w)) return false;
      return !(w.kind === kind && w.instance === instance);
    })
    .sort((a, b) => isLate(a) - isLate(b) || a.z - b.z || (at.get(a) ?? 0) - (at.get(b) ?? 0));
}

/** FR-SHELL-101's squeeze order: Game log, then DM Initiative / player sheet, then player Initiative. */
const SQUEEZE: Record<"dm" | "player", readonly string[]> = {
  dm: ["dice.log", "cbt.initiative"],
  player: ["dice.log", "char.sheet", "cbt.initiative"],
};

/** FR-SHELL-98: a rung at the 12-px gap, then retried at 4 px. */
const GAPS = [EDGE_GAP, 4] as const;

/** FR-SHELL-108: a yield keeps ≥ 75 % of the last full fit's cell, and ≥ 24 px. */
export const YIELD_SHARE = 0.75;
export const YIELD_MIN_CELL = 24;

type Rung = "L1" | "L2" | "L2s" | "L2b" | "L4" | "L5";

interface Spot {
  rect: Rect;
  rung: Rung;
  pcClear: boolean;
}

/**
 * The window's target size (FR-SHELL-100): the stored size when the user sized it, else the
 * type's default size for this viewport (fitted to the usable area by the spot search).
 */
export function targetSize(w: WindowState, def: WindowDef, vp: Viewport): Size {
  return w.userSize ? { w: w.w, h: w.h } : defaultSizeAt(def, vp);
}

/**
 * FR-SHELL-100: an entry stored before `userSize` existed is the user's size iff it has a user
 * spot and its size is neither a known default (FR-SHELL-53) nor the min size.
 */
export function inferUserSize(w: WindowState, def: WindowDef | undefined): WindowState {
  if (!def || w.userSize || !w.userSpot) return w;
  const sizes = [...knownDefaultSizes(def), def.minSize];
  if (sizes.some((s) => s.w === w.w && s.h === w.h)) return w;
  return { ...w, userSize: true };
}

/** Parses a `viewport:<w>×<h>` cause. */
const causeViewport = (cause: string): Viewport | null => {
  const m = /^viewport:(\d+)×(\d+)$/.exec(cause);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
};

/**
 * One settle (FR-SHELL-95): `ws` = the windows before the trigger. Returns the plan: the next
 * windows (same array when nothing changed), the displacement memory, and what it did.
 */
export function settle(ws: Windows, trigger: Trigger, ctx: ManagerContext): Plan {
  const vp = ctx.viewport;
  const area = workArea(vp);
  const registry = ctx.registry;
  const regions = keepOutsOf(ctx);
  // A pushing bar is a hard keep-out, reported or not yet (FR-SHELL-104).
  const unreported =
    trigger.type === "push" && !regions.some((k) => sameRect(k.rect, trigger.rect));
  const hard = [...hardRects(regions), ...(unreported ? [plainRect(trigger.rect)] : [])];
  const soft = softRects(regions);
  // A `viewport` settle with a `fitted` camera: the map's resize refit follows it (FR-MAP-98), so
  // the tokens drawn now sit where the old viewport's fit put them; PCs count after the refit.
  const fitted = (ctx.camera?.() ?? "fitted") === "fitted";
  const tokens = trigger.type === "viewport" && fitted ? [] : (ctx.avoid?.() ?? []);
  // FR-SHELL-158 (BL-82): one token grid per (window, size, gap) for every search of this settle.
  const memo = placeMemo(tokens);
  let out: WindowState[] = [...ws];
  const memory = new Map<string, Displacement>(
    (ctx.memory?.() ?? []).map((d) => [windowId(d.kind, d.instance), d]),
  );
  const placed = new Map<string, Placed>();
  const pcFlags = new Map<string, boolean>();
  const putAway = new Map<string, string>();
  const log: string[] = [];
  let yields = false;
  /** FR-MAP-114: a protected window went back to its zone over a PC (`fitted`): one refit. */
  let refit: "window" | undefined;
  const late = new Set<string>();
  const label = trigger.type;

  const get = (id: string) => out.find((w) => idOf(w) === id);
  /** FR-SHELL-145: a remembered window is never written by the placer (I9, I12). */
  const setWin = (id: string, next: WindowState) => {
    out = out.map((w) => (idOf(w) === id && !isRemembered(w) ? next : w));
  };
  const defOf = (w: WindowState) => registry.get(w.kind);
  const isProt = (w: WindowState) => defOf(w)?.defaultOpen === true;
  // Rendered rects of the windows as they are now, computed once per change of `out`.
  let shownCache: { at: WindowState[]; map: Map<WindowState, Rect> } | null = null;
  const shownMap = () => {
    if (shownCache?.at !== out) shownCache = { at: out, map: shownRects(out, ctx) };
    return shownCache.map;
  };
  const rendered = (w: WindowState) => shownMap().get(w) ?? shownRect(out, w, ctx);
  const need = (w: WindowState, def: WindowDef) =>
    growsToContent(w, def) ? ctx.heights?.(idOf(w)) : undefined;

  /**
   * The rendered windows other than `id`; with `protectedOnly` (a zone and its ladder) only the
   * untouched protected ones: zones ignore remembered windows (FR-SHELL-151).
   */
  const obstacles = (id: string, protectedOnly = false): Obstacle[] => {
    const res: Obstacle[] = [];
    for (const [w, r] of shownMap()) {
      if (idOf(w) === id || moving.has(idOf(w))) continue;
      const prot = isProt(w);
      if (protectedOnly && (!prot || isRemembered(w))) continue;
      if (protectedOnly && zoned !== null && !zoned.has(idOf(w))) continue;
      res.push({ ...r, protected: prot });
    }
    return res;
  };
  /** Windows a push displaces and hasn't placed yet: off the bar, never an obstacle. */
  let moving = new Set<string>();
  /**
   * During a zone pass, the protected windows already placed in it (FR-SHELL-111: zones in
   * registry order): a later one fits around them, not around where the others were.
   */
  let zoned: Set<string> | null = null;
  /** Zones for every shown protected window, then the launcher windows over them move. */
  const zonePass = (cause?: string) => {
    zoned = new Set();
    const ids = protectedIds();
    for (const id of ids) {
      placeProtected(id, "zone", cause, false);
      zoned.add(id);
    }
    zoned = null;
    for (const id of ids) displaceFrom(id, cause);
  };

  /** No PC footprint + 4 px under `r` (FR-SHELL-57). */
  const pcFree = (r: Rect) => pcClear(r, tokens);
  /** Clear of every other rendered window (no overlap) and hard keep-out. */
  const clearAt = (r: Rect, id: string, protectedOnly = false) =>
    !obstacles(id, protectedOnly).some((o) => overlaps(r, o)) && !hard.some((k) => overlaps(r, k));
  /** PC footprint area under `r`, bare and grown by 4 px (L5's measure). */
  const pcAreas = (r: Rect) => {
    let bare = 0;
    for (const t of tokens) if (t.pc) bare += overlapArea(r, t);
    return [bare, pcAreaUnder(r, tokens)] as const;
  };
  /** `prev` (the window's current rect, clear) covers no more PC footprint than `next`. */
  const staysAt = (id: string, prev: Rect, next: Rect) => {
    const w = get(id);
    if (!w || !inside(prev) || !clearAt(prev, id)) return false;
    const [pb, pg] = pcAreas(prev);
    const [nb, ng] = pcAreas(next);
    return pb < nb || (pb === nb && pg <= ng);
  };
  /** Inside the work area (FR-SHELL-29's: below the top bar, above the launcher). */
  const inside = (r: Rect) =>
    r.x >= 0 && r.y >= TOP_BAR_H && r.x + r.w <= vp.w && r.y + r.h <= vp.h - LAUNCHER_CLEAR;

  /** Records a displacement's first prior state for `cause` (FR-SHELL-102). */
  const remember = (w: WindowState, cause: string, at: Rect | null) => {
    const id = idOf(w);
    const prior = memory.get(id);
    memory.set(
      id,
      prior
        ? { ...prior, at }
        : {
            kind: w.kind,
            instance: w.instance,
            rect: plainRect(w),
            ...(w.userSpot && { userSpot: true as const }),
            ...(w.userSize && { userSize: true as const }),
            cause,
            at,
          },
    );
  };

  /**
   * Writes a shell rect (FR-SHELL-110: with `area`, no user spot or size; `keepSize`: a protected
   * window at its zone keeps its user size). An unchanged window stays the same object.
   */
  const write = (
    id: string,
    r: Rect,
    how: Placed,
    opts: { cause?: string; rung?: string; keepSize?: boolean } = {},
  ) => {
    const w = get(id);
    if (!w) return;
    if (opts.cause) remember(w, opts.cause, plainRect(r));
    else {
      // The shell's own later moves don't count as touches: the memory follows them.
      const m = memory.get(id);
      if (m && m.at !== null) memory.set(id, { ...m, at: plainRect(r) });
    }
    // A user size the shell keeps (a zone at it, a displacement at it) stays the user's.
    const keep = w.userSize === true && (opts.keepSize === true || (r.w === w.w && r.h === w.h));
    const same = sameRect(w, r) && w.area?.w === area.w && w.area?.h === area.h;
    const next =
      same && !w.userSpot && (keep || !w.userSize)
        ? w
        : { ...shellRect(w, r, area), ...(keep && { userSize: true as const }) };
    if (next !== w) setWin(id, next);
    placed.set(id, how);
    pcFlags.set(id, pcFree(rendered(next)));
    log.push(`${label}:${w.kind}>${opts.rung ?? how}`);
  };

  const putAwayWin = (w: WindowState, cause: string | null, forKind: string) => {
    const id = idOf(w);
    if (cause) remember(w, cause, null);
    else {
      // FR-SHELL-159 (BL-87): put away for an open, it never comes back (FR-SHELL-152): the
      // squeezes it caused are the opened window's now, and end when that one does.
      for (const [k, d] of memory) {
        if (d.cause === `window:${w.kind}`) memory.set(k, { ...d, cause: `window:${forKind}` });
      }
    }
    setWin(id, { ...w, state: "minimised" });
    putAway.set(id, cause ?? `open:${forKind}`);
    ctx.onAutoMinimise?.(id, forKind);
  };

  /**
   * The ladder (FR-SHELL-97) for window `id`; `cause`: a transient cause (put-aways remember it);
   * `protectedOnly`: only protected windows are obstacles (a zone's fallback); `maxL2`: L1–L2
   * only (grow back), null when nothing is found there.
   */
  const ladder = (
    id: string,
    o: {
      cause?: string;
      prev?: Rect;
      putAway: boolean;
      protectedOnly?: boolean;
      squeeze?: boolean;
      maxL2?: boolean;
      /** A tool-bar push (FR-SHELL-104): the map never yields for it (FR-SHELL-48). */
      push?: boolean;
    },
  ): Spot | null => {
    const w0 = get(id);
    const def = w0 && defOf(w0);
    if (!w0 || !def) return null;
    const size = targetSize(w0, def, vp);
    const u = useful(def, vp, registry);
    const floor = { w: Math.min(u.w, size.w), h: Math.min(u.h, size.h) };
    const input = (): PlaceInput => ({
      windows: obstacles(id, o.protectedOnly),
      hard,
      soft,
      tokens,
      need: need(w0, def),
      size,
      memo,
      ...(o.prev && { prev: o.prev }),
    });
    const accepted = (p: Placement | null) => p?.clear === true && p.pcClear;
    const tryAt = (more: Partial<PlaceInput>): Placement | null => {
      const base = input();
      for (const gap of GAPS) {
        const p = clearSearch(def, { ...base, ...more, gap });
        if (accepted(p)) return p;
      }
      return null;
    };
    const order = () => autoMinimiseOrder(out, ctx, w0.kind, w0.instance, late);
    let aheadUseful: boolean | null = null;
    let aheadMin: boolean | null = null;
    /**
     * The look-ahead (FR-SHELL-97 L3): the same with every launcher window put away; at the useful
     * size the map's yield counts too (F9: put Stats away, then the map yields to the card, before
     * either goes below useful).
     */
    const lookAhead = (more: Partial<PlaceInput>) => {
      const gone = new Set(order().map(idOf));
      const keep: Obstacle[] = [];
      for (const [w, r] of shownMap()) {
        if (idOf(w) === id || gone.has(idOf(w))) continue;
        if (o.protectedOnly && (!isProt(w) || isRemembered(w))) continue;
        keep.push({ ...r, protected: isProt(w) });
      }
      const p = clearSearch(def, { ...input(), windows: keep, ...more, gap: 4 });
      if (accepted(p)) return true;
      return !o.push && more.floor !== undefined
        ? yieldFor(def, { ...input(), windows: keep }, more.floor, true) !== null
        : false;
    };
    /**
     * Whether some spot ≥ `floor` is accepted at all: one search at the 4-px gap (the most
     * permissive; every L1 candidate is an L2 one), before the rung-by-rung searches.
     */
    const anyAt = (more: Partial<PlaceInput>) =>
      accepted(clearSearch(def, { ...input(), ...more, gap: 4 }));
    let squeezed = false;
    for (;;) {
      if (anyAt({ floor })) {
        const l1 = tryAt({ floor: size });
        // Within L1–L2 the edge column ranks before the inward ones (FR-SHELL-45 (3), map-first
        // #162): a full-size spot mid-map loses to the edge at a size down to useful.
        const l2 = !l1 || l1.inward ? tryAt({ floor }) : null;
        if (l1 && (!l1.inward || !l2 || l2.inward))
          return { rect: l1.rect, rung: "L1", pcClear: true };
        if (l2) return { rect: l2.rect, rung: "L2", pcClear: true };
      } else if (o.squeeze && !squeezed) {
        // Once: after a put-away the restart only needs L1–L2 (the look-ahead found room).
        squeezed = true;
        const s = squeezeFor(w0, () => (anyAt({ floor }) ? tryAt({ floor }) : null));
        if (s) return s;
      }
      const yielded = o.push ? null : yieldFor(def, input(), floor);
      if (yielded) return yielded;
      if (o.maxL2) return null;
      const first = o.putAway ? order()[0] : undefined;
      if (first) {
        aheadUseful ??= lookAhead({ floor });
        if (aheadUseful) {
          putAwayWin(first, o.cause ?? null, w0.kind);
          continue;
        }
      }
      const l4 = anyAt({}) ? tryAt({}) : null;
      if (l4) return { rect: l4.rect, rung: "L4", pcClear: true };
      if (first) {
        aheadMin ??= lookAhead({});
        if (aheadMin) {
          putAwayWin(first, o.cause ?? null, w0.kind);
          continue;
        }
      }
      const e = placeWindow(def, vp, { ...input(), leastPc: true });
      if (e.clear && !e.pcClear && o.prev && staysAt(id, o.prev, e.rect)) {
        // Least movement (ADR-0060 §4): L5 never trades the window's own clear rect for one over
        // more PC footprint (walkthrough F14: a margin touched after a reload's fit).
        return { rect: o.prev, rung: "L5", pcClear: pcFree(o.prev) };
      }
      if (e.clear) return { rect: e.rect, rung: e.pcClear ? "L4" : "L5", pcClear: e.pcClear };
      if (first) {
        putAwayWin(first, o.cause ?? null, w0.kind);
        continue;
      }
      const last = placeWindow(def, vp, { ...input(), leastPc: true, lastResort: true });
      return { rect: last.rect, rung: "L5", pcClear: last.pcClear };
    }
  };

  /**
   * A search whose answer only matters when clear (accepted, a yield): skipped when no clear spot
   * of its size exists at all (`roomFor`, exact; FR-SHELL-158).
   */
  const clearSearch = (def: WindowDef, input: PlaceInput): Placement | null =>
    roomFor(def, vp, input) ? placeWindow(def, vp, input) : null;

  /** A protected window's rect `r` shrunk to its useful size in its anchor corner (FR-SHELL-101). */
  const squeezeRect = (r: Rect, def: WindowDef): Rect => {
    const u = useful(def, vp, registry);
    const sw = Math.min(r.w, u.w);
    const sh = Math.min(r.h, u.h);
    const anchor = def.defaultPosition.anchor;
    return {
      x: anchor.endsWith("right") ? r.x + r.w - sw : r.x,
      y: anchor.startsWith("bottom") ? r.y + r.h - sh : r.y,
      w: sw,
      h: sh,
    };
  };
  /** Squeezed for a window still shown (its cause goes on, FR-SHELL-102). */
  const squeezedNow = (w: WindowState) => {
    const d = memory.get(idOf(w));
    return d !== undefined && d.at !== null && d.cause.startsWith("window:") && !ended(d);
  };

  /**
   * FR-SHELL-101 (OQ-SHELL-59 A): protected windows shrink inside their zone to their useful size,
   * one at a time in `SQUEEZE` order, until `retry` finds a spot; none helps → all restored.
   */
  const squeezeFor = (w: WindowState, retry: () => Placement | null): Spot | null => {
    const done: { id: string; before: WindowState }[] = [];
    for (const kind of SQUEEZE[registry.client]) {
      const p = find(out, kind, MAIN_INSTANCE);
      const def = p && defOf(p);
      // FR-SHELL-151: only untouched protected windows are squeezed.
      if (!p || !def?.defaultOpen || !isShown(p, ctx.available) || isRemembered(p)) continue;
      const r = rendered(p);
      const u = useful(def, vp, registry);
      if (r.w <= u.w && r.h <= u.h) continue;
      const s = squeezeRect(r, def);
      done.push({ id: idOf(p), before: p });
      // Stored height only (growth stays render-only): a grown window keeps its stored top.
      setWin(idOf(p), { ...shellRect(p, s, area), ...(p.fixedH && { fixedH: true as const }) });
      const spot = retry();
      if (spot) {
        // Least movement (ADR-0060 §4): an earlier squeeze the spot doesn't need is undone.
        for (const d of done.slice(0, -1)) {
          const squeezedTo = get(d.id) as WindowState;
          setWin(d.id, d.before);
          const r = rendered(d.before);
          const near = { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 };
          if (overlaps(near, spot.rect) || !clearAt(spot.rect, idOf(w))) setWin(d.id, squeezedTo);
        }
        for (const d of done.filter((x) => get(x.id) !== x.before)) {
          const now = get(d.id) as WindowState;
          remember(d.before, `window:${w.kind}`, plainRect(now));
          placed.set(d.id, "squeezed");
          pcFlags.set(d.id, pcFree(rendered(now)));
          log.push(`${label}:${d.before.kind}>squeezed`);
        }
        return { rect: spot.rect, rung: "L2s", pcClear: true };
      }
    }
    for (const d of done.reverse()) setWin(d.id, d.before);
    return null;
  };

  /**
   * FR-SHELL-108 (OQ-SHELL-64 B, players, `fitted` camera): a spot ≥ useful, clear of windows but
   * over PCs, is accepted iff the dry fit with it as an obstacle keeps every PC (and every token
   * the fit kept) clear at ≥ 75 % of the last full fit's cell and ≥ 24 px; the map then refits.
   */
  const yieldFor = (def: WindowDef, input: PlaceInput, floor: Size, dry = false): Spot | null => {
    if (registry.client !== "player" || !ctx.dryFit || ctx.camera?.() !== "fitted") return null;
    const last = ctx.lastFullCell?.();
    if (!last) return null;
    // The target size first (a yielded window isn't left shell-shrunk to grow back later), then
    // down to useful.
    const sizes =
      input.size && (input.size.w > floor.w || input.size.h > floor.h) ? [input.size] : [];
    for (const f of [...sizes, floor]) {
      const p = clearSearch(def, { ...input, floor: f });
      if (!p?.clear || p.pcClear) continue;
      const fit = ctx.dryFit([...(input.windows ?? []).map(plainRect), p.rect]);
      if (!fit?.clear || fit.cellPx < Math.max(YIELD_SHARE * last, YIELD_MIN_CELL)) continue;
      if (!dry) yields = true;
      return { rect: p.rect, rung: "L2b", pcClear: true };
    }
    return null;
  };

  /** Places a launcher window through the ladder and writes it. */
  const placeLauncher = (
    id: string,
    how: Placed | ((r: Rect) => Placed),
    o: { cause?: string; prev?: Rect; putAway?: boolean } = {},
  ) => {
    const w = get(id);
    if (!w) return;
    const spot = ladder(id, { ...o, putAway: o.putAway ?? true, squeeze: true });
    if (!spot) return;
    if (o.cause && spot.rung === "L5") {
      // A window displaced for a transient cause is put away itself rather than cover a PC
      // (#310; as a pushed one, OQ-SHELL-61 A); it returns when the cause ends (FR-SHELL-102).
      const cur = get(id) as WindowState;
      putAwayWin(cur, o.cause, o.cause.slice(o.cause.indexOf(":") + 1));
      log.push(`${label}:${cur.kind}>put-away`);
      return;
    }
    late.add(id);
    const kind = typeof how === "function" ? how(spot.rect) : how;
    write(id, spot.rect, kind, { ...(o.cause && { cause: o.cause }), rung: spot.rung });
    pcFlags.set(id, spot.pcClear);
  };

  /**
   * FR-SHELL-104: one window off a hard keep-out, through the ladder (cause `toolbar:<id>`),
   * ranked nearest its pre-push rect (FR-SHELL-111 (8): the first one a push remembered). Never
   * the map's yield, nor a squeeze or a put-away of another window (OQ-SHELL-61 A): a launcher
   * window with no spot ≥ useful is put away itself until `return`; a protected one goes below
   * useful (L4), else the least PC area (L5, flagged).
   */
  const pushOne = (id: string, cause: string) => {
    const w = get(id);
    if (!w) return;
    const m = memory.get(id);
    const prev = m?.cause === cause ? m.rect : plainRect(w);
    if (isProt(w)) {
      const spot = ladder(id, { cause, prev, putAway: false, push: true });
      if (!spot) return;
      write(id, spot.rect, "pushed", { cause, rung: spot.rung });
      pcFlags.set(id, spot.pcClear);
      return;
    }
    const spot = ladder(id, { cause, prev, putAway: false, maxL2: true, push: true });
    if (spot) {
      write(id, spot.rect, "pushed", { cause, rung: spot.rung });
      pcFlags.set(id, spot.pcClear);
      return;
    }
    putAwayWin(w, cause, cause.slice(cause.indexOf(":") + 1));
    log.push(`${label}:${w.kind}>put-away`);
  };

  /**
   * FR-SHELL-104: every shown window over `bar` grown by 12 px is displaced: protected ones first
   * (registry order), then the launcher windows by descending z (FR-SHELL-111). The ones still
   * waiting are no obstacle (they leave the bar). Untouched windows only (FR-SHELL-104, -150).
   */
  const pushFrom = (bar: Rect, cause: string) => {
    const grown = {
      x: bar.x - EDGE_GAP,
      y: bar.y - EDGE_GAP,
      w: bar.w + 2 * EDGE_GAP,
      h: bar.h + 2 * EDGE_GAP,
    };
    const hit = new Set(
      [...shownMap()]
        .filter(([, r]) => overlaps(r, grown))
        // A remembered window's push is render-only (FR-SHELL-150): never written here.
        .filter(([w]) => !defOf(w)?.fixedDefault && !isRemembered(w))
        .map(([w]) => idOf(w)),
    );
    const order = [
      ...protectedIds().filter((id) => hit.has(id)),
      ...launchersByZ().filter((id) => hit.has(id)),
    ];
    moving = new Set(order);
    for (const id of order) {
      moving.delete(id);
      pushOne(id, cause);
    }
    moving = new Set();
  };

  const autoKind = (w: WindowState) => (r: Rect) => {
    const def = defOf(w);
    return def ? placedAs(def, r, vp, hard) : "auto";
  };

  let named: WindowState[] | null = null;
  /**
   * The zone rect of a protected window (FR-SHELL-99): its rect in this viewport's named default
   * layout (token-free, the toast regions only); a user-sized one at its default anchor.
   */
  const zoneOf = (w: WindowState): Rect | null => {
    const def = defOf(w);
    if (!def) return null;
    const toasts = keepOuts(registry.client, vp, new Map());
    if (w.userSize) return fittedDefaultRect(def, vp, hardRects(toasts), { w: w.w, h: w.h });
    named ??= defaultLayout(registry, vp, [], toasts);
    const z = named.find((d) => d.kind === w.kind);
    return z ? plainRect(z) : fittedDefaultRect(def, vp, hard);
  };

  /**
   * FR-SHELL-99, -107: an untouched protected window takes its zone iff PC-clear (and clear of
   * the other untouched protected windows; remembered windows ignored, FR-SHELL-151), else the
   * ladder among them, zone first; a remembered one keeps its rect. Then the untouched launcher
   * windows over it are displaced (cause `window:<kind>`).
   */
  const placeProtected = (id: string, how: Placed = "zone", cause?: string, displace = true) => {
    const w = get(id);
    // FR-SHELL-145, -149: a remembered protected window keeps its rect and makes no room.
    if (!w || !isShown(w, ctx.available) || isRemembered(w)) return;
    const full = zoneOf(w);
    const def = defOf(w);
    // A squeeze whose cause goes on stays squeezed in the zone (a viewport change). After a
    // reload (memory dropped; a squeeze is never stored, FR-SHELL-159) the squeeze comes back
    // iff an untouched launcher window still sits in the full zone and clears the squeezed rect:
    // that window is its cause again (WF2 notes: the DM's reload kept the layout).
    const reCause =
      trigger.type === "load" && full && def && !squeezedNow(w)
        ? loadSqueezeCause(id, full, squeezeRect(full, def))
        : undefined;
    const z = full && def && (squeezedNow(w) || reCause) ? squeezeRect(full, def) : full;
    if (z) {
      const atZone = { ...w, ...z };
      const at = shownRects(
        out.map((x) => (idOf(x) === id ? atZone : x)),
        ctx,
      );
      const r = at.get(atZone) ?? shownRect(out, atZone, ctx);
      // With a `fitted` camera the map refits after the placer and clears the tokens (FR-SHELL-99,
      // FR-MAP-96, -98): the camera the PCs are drawn at now is the one before that refit. The
      // other protected windows count as drawn with this one at its zone: a neighbour grown into
      // the zone's room while it was squeezed shrinks back (BL-87, walkthrough M9).
      if ((fitted || pcFree(r)) && clearOfProtected(r, id, at)) {
        write(id, z, how, { rung: "zone", keepSize: true });
        if (reCause && full) {
          remember({ ...w, ...full }, `window:${reCause}`, plainRect(z));
          placed.set(id, "squeezed");
        }
      } else {
        // Least movement (ADR-0060 §4): a spot the ladder gave it earlier that still holds (inside,
        // clear of the protected windows, PC-clear, ≥ useful) is kept; else the ladder.
        // A shrunk one goes through the ladder again (it may grow back, L1 first).
        const cur = rendered(w);
        const holds =
          !sameRect(w, z) &&
          w.w === z.w &&
          w.h === z.h &&
          inside(w) &&
          clearAt(cur, id, true) &&
          pcFree(cur);
        if (!holds) {
          setWin(id, { ...w, ...z });
          const spot = ladder(id, { prev: plainRect(w), putAway: false, protectedOnly: true });
          if (spot) write(id, spot.rect, "auto", { rung: spot.rung });
          if (spot) pcFlags.set(id, spot.pcClear);
        }
      }
    }
    if (displace) displaceFrom(id, cause);
  };

  /** Launcher windows over protected window `id` move out (FR-SHELL-99), highest z first. */
  const displaceFrom = (id: string, cause?: string) => {
    const p = get(id);
    if (!p || !isShown(p, ctx.available) || isRemembered(p)) return;
    const pr = rendered(p);
    const hits = [...shownMap()]
      .filter(([w, r]) => {
        const def = defOf(w);
        // A remembered window in the zone stays, under it (FR-SHELL-151, OQ-SHELL-79 A).
        if (idOf(w) === id || !def || def.defaultOpen || def.fixedDefault || isRemembered(w)) {
          return false;
        }
        return overlaps(pr, r);
      })
      .map(([w]) => w)
      .sort((a, b) => b.z - a.z);
    for (const w of hits) {
      const cur = get(idOf(w));
      if (!cur || !isShown(cur, ctx.available)) continue;
      placeLauncher(idOf(cur), "displaced", {
        cause: cause ?? `window:${p.kind}`,
        prev: plainRect(cur),
      });
    }
  };

  /**
   * Load / viewport (FR-SHELL-53 folded in, FR-SHELL-103): a launcher window keeps its rect if
   * it is inside, accepted and ≥ useful; one still at another viewport class's default size (or a
   * previous default) first takes its target size where it is; else the ladder. User spots only
   * render-fit. `pcs`: PCs are known (no PC test before the first token draw).
   */
  const keepOrPlace = (id: string, cause?: string, pcs = true, load = false) => {
    const w = get(id);
    const def = w && defOf(w);
    if (!w || !def || !isShown(w, ctx.available) || def.fixedDefault) return;
    if (isRemembered(w)) return;
    // The settle after the first token draw reconsiders the restored layout only: a window
    // placed on this page since (an open, a displacement) keeps its spot (no re-placing when a PC
    // comes under a window, play-shell §16).
    const how = ctx.placed?.(id);
    if (load && pcs && how !== undefined && how !== "stored" && how !== "zone") return;
    const size = targetSize(w, def, vp);
    const atDefault = knownDefaultSizes(def).some((s) => s.w === w.w && s.h === w.h);
    const migrate = !w.userSize && !w.fixedH && atDefault && (w.w !== size.w || w.h !== size.h);
    // Load: the written layout is the settled one (overlaps included, FR-SHELL-56 (6)); only a
    // window at another class's default migrates, and a shell spot over a PC moves.
    if (load && !migrate && (!pcs || pcFree(rendered(w)))) return;
    if (migrate) {
      const fitted = fittedDefaultRect(def, vp, hard, size);
      const cand = { x: w.x, y: w.y, w: fitted.w, h: fitted.h };
      const r = shownRect(
        out.map((x) => (idOf(x) === id ? { ...x, ...cand, area } : x)),
        { ...w, ...cand, area },
        ctx,
      );
      if (inside(cand) && clearAt(r, id) && (!pcs || pcFree(r))) {
        write(id, cand, "grown", { rung: "grown" });
        return;
      }
    }
    const r = rendered(w);
    const u = useful(def, vp, registry);
    const big = r.w >= Math.min(u.w, size.w) && r.h >= Math.min(u.h, size.h);
    if (inside(w) && clearAt(r, id) && (!pcs || pcFree(r)) && big) return;
    placeLauncher(id, cause ? "displaced" : autoKind(w), {
      ...(cause && { cause }),
      prev: plainRect(w),
    });
  };

  /** Shown launcher windows by descending z (FR-SHELL-111's window order). */
  const launchersByZ = () =>
    out
      .filter((w) => isShown(w, ctx.available) && !isProt(w))
      .sort((a, b) => b.z - a.z)
      .map(idOf);
  /** Shown protected windows in registry order. */
  const protectedIds = () =>
    registry.defs
      .filter((d) => d.defaultOpen)
      .flatMap((d) => out.filter((w) => w.kind === d.kind && isShown(w, ctx.available)))
      .map(idOf);

  /** A memory entry whose cause ended (FR-SHELL-102). */
  const ended = (d: Displacement) => {
    if (d.cause.startsWith("toolbar:")) {
      const keep = d.cause.slice("toolbar:".length);
      return !regions.some((k) => k.id === keep);
    }
    const v = causeViewport(d.cause);
    if (v) return vp.w >= v.w && vp.h >= v.h;
    if (d.cause.startsWith("window:")) {
      // The kind closes, is minimised by the user or ends; one the shell put away for a transient
      // cause comes back (one put away for an open hands its squeezes on, `putAwayWin`).
      const kind = d.cause.slice("window:".length);
      const away = ctx.autoMinimised?.() ?? new Set<string>();
      return !out.some(
        (w) =>
          w.kind === kind &&
          ctx.available.has(w.kind) &&
          (w.state === "open" ||
            (w.state === "minimised" && (away.has(idOf(w)) || putAway.has(idOf(w))))),
      );
    }
    return true;
  };

  /**
   * FR-SHELL-102: windows whose cause ended return, ascending z, iff untouched and the old rect
   * is clear (a shell spot also PC-clear); else they grow toward their target by L1–L2, putting
   * nothing away. `onlyToolbar`: the toolbar's return keeps today's FR-SHELL-81 scope.
   */
  const returns = (only?: (d: Displacement) => boolean) => {
    const due = [...memory.values()]
      .filter((d) => ended(d) && (!only || only(d)))
      .map((d) => ({ d, w: find(out, d.kind, d.instance) }))
      .filter((e): e is { d: Displacement; w: WindowState } => e.w !== undefined)
      .sort((a, b) => a.w.z - b.w.z);
    const pending = new Set(due.map((e) => idOf(e.w)));
    for (const { d } of due) {
      const id = windowId(d.kind, d.instance);
      memory.delete(id);
      pending.delete(id);
      const w = get(id);
      if (!w || !ctx.available.has(w.kind)) continue;
      const untouched = d.at === null ? w.state === "minimised" : sameRect(w, d.at);
      if (!untouched || (d.at !== null && w.state !== "open")) continue;
      if (isProt(w) && d.cause.startsWith("window:") && !d.userSpot && !d.userSize) {
        zoneBack(id, d);
        continue;
      }
      const back: WindowState = {
        ...shellRect(w, d.rect, area),
        state: "open",
        ...(d.userSpot && { userSpot: true as const }),
        ...(d.userSize && { userSize: true as const }),
      };
      const others = out.filter((x) => idOf(x) !== id && !pending.has(idOf(x)));
      const r = shownRect([...others, back], back, ctx);
      const blocked = [...shownRects(others, ctx).values()].some((o) => overlaps(r, o));
      const free = !blocked && !hard.some((k) => overlaps(r, k));
      if (free && (d.userSpot || pcFree(r))) {
        setWin(id, back);
        placed.set(id, "returned");
        pcFlags.set(id, pcFree(r));
        log.push(`${label}:${w.kind}>returned`);
        continue;
      }
      if (isProt(w)) continue;
      // Not back: grow toward the target where it is (L1–L2, nothing put away); a put-away one
      // opens only if that finds a spot.
      const was = w;
      if (w.state !== "open") setWin(id, { ...w, state: "open" });
      const spot = ladder(id, { putAway: false, maxL2: true, prev: d.rect });
      if (spot) {
        write(id, spot.rect, "grown", { rung: spot.rung });
      } else if (was.state !== "open") {
        setWin(id, was);
        // Still put away: a later settle tries again (a window displaced by the same cause may
        // still hold its spot, e.g. one whose own viewport cause ends one size later).
        memory.set(id, d);
      }
    }
  };

  /**
   * Whether `id`'s zone rect `z`, as rendered, is free, and else the untouched window in its way
   * (`by`; none when a hard keep-out blocks it: no window to wait for). Remembered windows are
   * ignored, as for zones (FR-SHELL-151). The others count as drawn with `id` at its zone: a
   * growing neighbour that grew into the room the squeeze freed is capped by it again (BL-87).
   */
  const zoneBlocker = (id: string, z: Rect): { free: boolean; by?: WindowState } => {
    const atZone = { ...(get(id) as WindowState), ...z };
    const at = shownRects(
      out.map((x) => (idOf(x) === id ? atZone : x)),
      ctx,
    );
    const r = at.get(atZone) ?? clampRect(atZone, vp);
    if (hard.some((k) => overlaps(r, k))) return { free: false };
    for (const [o, or] of at) {
      if (o === atZone || isRemembered(o) || !overlaps(r, or)) continue;
      return { free: false, by: o };
    }
    return { free: true };
  };

  /**
   * Clear of the other untouched protected windows (as `at` draws them: a zone pass's not yet
   * placed ones aside) and of the hard keep-outs: the zone test (FR-SHELL-99, -151).
   */
  const clearOfProtected = (r: Rect, id: string, at: ReadonlyMap<WindowState, Rect>) => {
    if (hard.some((k) => overlaps(r, k))) return false;
    for (const [o, or] of at) {
      if (idOf(o) === id || moving.has(idOf(o)) || !isProt(o) || isRemembered(o)) continue;
      if (zoned !== null && !zoned.has(idOf(o))) continue;
      if (overlaps(r, or)) return false;
    }
    return true;
  };

  /**
   * At `load` (FR-SHELL-159): the untouched launcher window sitting in protected window `id`'s
   * full zone and clear of its squeezed rect, whose squeeze it caused before the reload.
   */
  const loadSqueezeCause = (id: string, full: Rect, squeezed: Rect): string | undefined => {
    let cause: string | undefined;
    for (const [o, or] of shownMap()) {
      if (idOf(o) === id || isProt(o) || isRemembered(o) || !overlaps(or, full)) continue;
      if (overlaps(or, squeezed)) return undefined;
      cause ??= o.kind;
    }
    return cause;
  };

  /**
   * FR-SHELL-159 (BL-87): a squeezed (or shell-shrunk) untouched protected window whose cause
   * ended goes back to its zone rect iff that is clear of untouched windows and hard keep-outs
   * (remembered windows ignored); with a `fitted` camera a PC under it is the map's (one `window`
   * refit, FR-MAP-114), with `moved` the zone ladder as built. Not clear: it waits for the
   * untouched window in the way (its memory's cause becomes that window); `d` absent (grow back,
   * FR-SHELL-103) → nothing is remembered.
   */
  const zoneBack = (id: string, d?: Displacement): boolean => {
    const w = get(id);
    const full = w && zoneOf(w);
    if (!w || !full) return false;
    const { free, by } = zoneBlocker(id, full);
    if (!free) {
      if (d) memory.set(id, by ? { ...d, cause: `window:${by.kind}` } : d);
      return false;
    }
    placeProtected(id, d ? "returned" : "grown");
    const now = get(id) as WindowState;
    if (fitted && sameRect(now, full) && !pcFree(rendered(now))) refit = "window";
    return true;
  };

  /** FR-SHELL-103 up: shell-shrunk windows grow back toward their target (L1–L2, none put away). */
  const growBack = () => {
    // FR-SHELL-159: shell-shrunk untouched protected windows grow back to their zone.
    for (const id of protectedIds()) {
      const w = get(id);
      const full = w && !isRemembered(w) && !squeezedNow(w) && zoneOf(w);
      if (!w || !full || (w.w >= full.w && w.h >= full.h)) continue;
      zoneBack(id);
    }
    for (const id of [...launchersByZ()].reverse()) {
      const w = get(id);
      const def = w && defOf(w);
      if (!w || !def || w.userSize || w.userSpot || def.fixedDefault) continue;
      const size = targetSize(w, def, vp);
      const fitted = fittedDefaultRect(def, vp, hard, size);
      if (w.w >= fitted.w && w.h >= fitted.h) continue;
      const spot = ladder(id, { putAway: false, maxL2: true, prev: plainRect(w) });
      if (spot && spot.rect.w * spot.rect.h > w.w * w.h) {
        write(id, spot.rect, "grown", { rung: spot.rung });
      }
    }
    // OQ-SHELL-60 B: windows the small screen put away come back if they fit, nothing put away.
    for (const d of [...memory.values()]) {
      if (d.at !== null || !causeViewport(d.cause)) continue;
      const id = windowId(d.kind, d.instance);
      const w = get(id);
      if (w?.state !== "minimised" || !ctx.available.has(w.kind)) continue;
      setWin(id, { ...w, state: "open" });
      const spot = ladder(id, { putAway: false, maxL2: true, prev: d.rect });
      if (spot) {
        write(id, spot.rect, "grown", { rung: spot.rung });
        memory.set(id, { ...d, at: plainRect(spot.rect) });
      } else setWin(id, w);
    }
  };

  switch (trigger.type) {
    case "reset": {
      // FR-SHELL-80: exactly the named (token-free) default layout; the map refits instead.
      out = defaultLayout(registry, vp, [], regions);
      memory.clear();
      for (const w of out) {
        placed.set(idOf(w), "zone");
        pcFlags.set(idOf(w), pcFree(w));
        log.push(`reset:${w.kind}>zone`);
      }
      break;
    }
    case "load": {
      zonePass();
      for (const id of launchersByZ()) keepOrPlace(id, undefined, trigger.drawn, true);
      break;
    }
    case "viewport": {
      const from = ctx.settledViewport ?? vp;
      const shrank = vp.w < from.w || vp.h < from.h;
      const cause = shrank ? `viewport:${from.w}×${from.h}` : undefined;
      // Zones first (the frame the rest fits around); a protected window's squeeze ends with them.
      zonePass(cause);
      for (const id of protectedIds()) {
        const p = get(id);
        if (p && placed.get(id) === "zone" && !squeezedNow(p)) memory.delete(id);
        else if (p && squeezedNow(p)) remember(p, "", plainRect(p));
      }
      returns();
      for (const id of launchersByZ()) keepOrPlace(id, cause);
      if (vp.w >= from.w && vp.h >= from.h) growBack();
      break;
    }
    case "open":
    case "reopen":
    case "appear":
    case "settle": {
      const id = windowId(trigger.kind, trigger.instance);
      const w = get(id);
      const def = w && defOf(w);
      if (!w || !def || !isShown(w, ctx.available)) break;
      if (isRemembered(w)) {
        // FR-SHELL-146, -149: a remembered window opens at its stored rect; no rung runs for
        // anyone (no move, squeeze, put-away, memory change or yield).
        placed.set(id, "stored");
        log.push(`${label}:${w.kind}>remembered`);
        break;
      }
      if (def.defaultOpen) {
        if (trigger.type === "settle") {
          const r = rendered(w);
          if (!pcFree(r) || !clearAt(r, id)) placeProtected(id);
        } else {
          // FR-SHELL-99, -107: its zone (a reopen, appearance, feature open); the windows over it
          // move.
          placeProtected(id);
        }
        break;
      }
      if (def.fixedDefault) break;
      if (trigger.type === "settle") {
        // FR-SHELL-40, -41: once its real height is known, a window the shell placed is placed
        // again if it covers another window or grew taller than its slot.
        if (ctx.placed?.(id) === "stored") break;
        const r = rendered(w);
        if (!clearAt(r, id) || r.h > w.h) placeLauncher(id, autoKind(w), { prev: plainRect(w) });
        break;
      }
      if (trigger.type === "open" && trigger.fresh) {
        placeLauncher(id, autoKind(w));
      } else if (trigger.type === "reopen") {
        // FR-SHELL-56: the stored rect unless covered (a shell spot also over a PC).
        if (isReopenCovered(out, w, ctx)) placeLauncher(id, "reopened");
      } else if (needsPlacing(out, w, ctx)) {
        placeLauncher(id, autoKind(w), { prev: plainRect(w) });
      }
      break;
    }
    case "push": {
      // FR-SHELL-104, -105: shown, a tool bar re-selected or swapped; the cause is the region at
      // that rect (the tool bar, a chrome keep-out).
      const at = regions.find((k) => k.kind === "hard" && sameRect(k.rect, trigger.rect));
      pushFrom(trigger.rect, at ? `toolbar:${at.id}` : TOOLBAR_CAUSE);
      break;
    }
    case "return": {
      // A cause ended (a keep-out went, a kind closed or ended): its windows come back; then
      // shell-shrunk windows grow toward their target where room returned (FR-SHELL-102).
      returns();
      growBack();
      break;
    }
    case "drag-end": {
      // The user's own move / resize (FR-SHELL-95): the window is remembered now (FR-SHELL-144),
      // its memory goes; nothing else moves. Dropped over a shown tool bar it is stored at the
      // drop rect and renders pushed until the bar goes (FR-SHELL-150, -167); over a PC it stays.
      memory.delete(windowId(trigger.kind, trigger.instance));
      // Nothing makes room for a remembered window (FR-SHELL-149): a squeeze it caused while it
      // was untouched ends here, the zone back iff clear (FR-SHELL-159, walkthrough M9).
      for (const d of [...memory.values()]) {
        if (d.cause !== `window:${trigger.kind}` || d.at === null) continue;
        const sid = windowId(d.kind, d.instance);
        const s = get(sid);
        if (!s || !isProt(s) || !sameRect(s, d.at) || !isShown(s, ctx.available)) continue;
        memory.delete(sid);
        zoneBack(sid, d);
      }
      break;
    }
  }

  const changed = out.length !== ws.length || out.some((w, i) => w !== ws[i]);
  return {
    windows: changed ? out : ws,
    memory: [...memory.values()],
    placed,
    pcClear: pcFlags,
    putAway,
    log,
    yields,
    ...(refit && { refit }),
  };
}

/**
 * FR-SHELL-164: `data-placed` as drawn. A remembered window is `stored` at its stored rect, or
 * `pushed` while a shown bar pushes it (render-only, FR-SHELL-150); any other window as the
 * placer placed it (`placed`).
 */
export function renderedPlaced(
  win: WindowState,
  def: Pick<WindowDef, "minSize">,
  vp: Viewport,
  bars: readonly Rect[],
  placed: Placed | undefined,
): Placed | undefined {
  if (!isRemembered(win)) return placed;
  const at = renderedRect(win, def.minSize, vp);
  return sameRect(at, placedRect(win, def.minSize, vp, bars)) ? "stored" : "pushed";
}

/**
 * What a layout entry stores (FR-SHELL-159, -102): never a transient displacement. A protected
 * window squeezed for a launcher window (`window:`) and a window a tool bar pushed or put away
 * (`toolbar:`), still where that put it, are written as they were before it; the page shows the
 * displaced rect meanwhile (memory, client only). A reload re-derives the squeeze while its cause
 * still sits in the zone (`load`); a tool bar doesn't survive a reload, so nothing is lost.
 */
export function persistable(ws: Windows, memory: readonly Displacement[]): Windows {
  let out: Windows = ws;
  for (const d of memory) {
    const squeeze = d.cause.startsWith("window:");
    if (!squeeze && !d.cause.startsWith("toolbar:")) continue;
    const w = find(out, d.kind, d.instance);
    if (!w || isRemembered(w)) continue;
    const still = d.at === null ? w.state === "minimised" : sameRect(w, d.at);
    if (!still || (squeeze && d.at === null)) continue;
    const back: WindowState = {
      ...w,
      ...plainRect(d.rect),
      ...(d.at === null && { state: "open" as const }),
    };
    out = out.map((x) => (x === w ? back : x));
  }
  return out;
}

/** The tool bar's cause (FR-SHELL-102): scenes-map's reported `map.toolbar` keep-out. */
export const TOOLBAR_CAUSE = "toolbar:map.toolbar";

/**
 * A stored window a feature brings up (feature open, appearance, its first layout) is placed when
 * it would cover a window on screen or a hard keep-out region (FR-SHELL-41, -48), or sits at a
 * rect the user didn't choose: auto-placed on this page, or at its fitted default rect
 * (FR-SHELL-40); a shell spot over a PC too (OQ-SHELL-55 B).
 */
function needsPlacing(ws: Windows, cur: WindowState, ctx: ManagerContext): boolean {
  const def = ctx.registry.get(cur.kind);
  if (!def) return false;
  if (isCovered(ws, cur, ctx)) return true;
  const hard = hardRects(keepOutsOf(ctx));
  const how = ctx.placed?.(idOf(cur));
  if (how === "auto" || how === "default" || how === "pushed") return true;
  if (!cur.userSpot && (how === "returned" || isReopenCovered(ws, cur, ctx))) return true;
  return sameRect(fittedDefaultRect(def, ctx.viewport, hard), cur);
}

/** PC footprints (+ 4 px) under `r`, as area (L5's measure, FR-SHELL-77 (e)). */
export function pcAreaUnder(r: Rect, tokens: readonly PlacementToken[]): number {
  let n = 0;
  for (const p of pcBoxes(tokens)) {
    n +=
      Math.max(0, Math.min(r.x + r.w, p.x + p.w) - Math.max(r.x, p.x)) *
      Math.max(0, Math.min(r.y + r.h, p.y + p.h) - Math.max(r.y, p.y));
  }
  return n;
}
