// Window manager reducer (FR-SHELL-08–12, 14, 16–18, 29, 40–42, 45–53, 55, 56, 77–81). Pure: no
// DOM, no storage. Holds every window's *stored* state; rendering fits and clamps (geometry.ts)
// without writing back. Every geometry it sets is stamped with the work area it was set in
// (`area`); a rect the shell chooses drops `userSpot`, a move / resize end sets it.
import { GEOMETRY_LIMIT, Layout, MAIN_INSTANCE, type WindowState } from "@shared/play-shell/layout";
import {
  clampRect,
  EDGE_GAP,
  growsToContent,
  LAUNCHER_CLEAR,
  type Rect,
  renderedRect,
  TOP_BAR_H,
  type Viewport,
  windowRects,
  workArea,
} from "./geometry";
import { hardRects, type KeepOut, keepOuts } from "./keep-outs";
import {
  fittedDefaultRect,
  type Obstacle,
  type Placeable,
  type PlaceInput,
  type PlacementToken,
  pcClear,
  placeWindow,
  RAIL_CLEAR,
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

export type WindowAction =
  | { type: "open"; kind: string; instance?: string; by?: OpenBy }
  | { type: "close"; kind: string; instance?: string }
  | { type: "minimise"; kind: string; instance?: string }
  | { type: "focus"; kind: string; instance?: string }
  | { type: "toggle"; kind: string; instance?: string }
  /** Move / resize end. `resized`: a user resize; on a `growToContent` type it sets `fixedH`. */
  | { type: "setRect"; kind: string; instance?: string; rect: Rect; resized?: boolean }
  /**
   * The kind just became available (e.g. player `cbt.initiative` on Start). If it is open and
   * would cover a window on screen, or still sits at a rect the user didn't choose, it is
   * auto-placed (FR-SHELL-40, -41); a user's spot clear of other windows is kept.
   */
  | { type: "appear"; kind: string; instance?: string }
  /**
   * First layout of a window placed by a feature open, an appearance or auto placement: once its
   * real height is known (FR-SHELL-39), it is placed again if it covers another open window or
   * grew taller than the slot it got (FR-SHELL-40, -41). Once; a user's stored rect never moves.
   */
  | { type: "settle"; kind: string; instance?: string }
  /**
   * A map tool bar appeared at `rect` (viewport px) or changed size (FR-SHELL-55): windows over it
   * are pushed right of it, written.
   */
  | { type: "push"; rect: Rect }
  /**
   * The tool bar went (FR-SHELL-81): windows still at their pushed rect go back to their pre-push
   * rect (`ctx.prePush`) where it is clear, written with the `userSpot` they had.
   */
  | { type: "return" }
  /**
   * The viewport changed while the page is shown (FR-SHELL-51, -53): never-resized windows at a
   * default size follow this viewport's default and placement, as on applying the entry.
   */
  | { type: "viewport" }
  | { type: "reset" };

export interface ManagerContext {
  registry: WindowRegistry;
  viewport: Viewport;
  /** Kinds rendered right now (registered + available). */
  available: ReadonlySet<string>;
  /**
   * On-screen map token boxes an auto-placed window covers the least of (FR-SHELL-40); `pc`
   * marks a token with an owner, whose centre it never covers while it can (FR-SHELL-45 (2)).
   */
  avoid?: () => readonly PlacementToken[];
  /** This client's keep-out regions now (FR-SHELL-48); default `keepOuts(client, viewport)`. */
  keepOuts?: () => readonly KeepOut[];
  /** How a window's current rect was chosen, if known on this page (`data-placed`). */
  placed?: (id: string) => Placed | undefined;
  /** Measured content height of a `growToContent` window (FR-SHELL-39), by window id. */
  heights?: (id: string) => number | undefined;
  /** Pushed windows' pre-push rects (FR-SHELL-81, client memory); read by `return`. */
  prePush?: () => readonly PrePush[];
  /** Called for each window auto-minimised for `forKind` (FR-SHELL-77, -88). */
  onAutoMinimise?: (id: string, forKind: string) => void;
}

/** A pushed window's spot before the push (FR-SHELL-81): client memory, never stored. */
export interface PrePush {
  kind: string;
  instance: string;
  /** Its stored rect before the first push of this tool use. */
  rect: Rect;
  /** Its `userSpot` then (OQ-SHELL-55 B), restored with the rect. */
  userSpot?: true;
  /** The stored rect the push wrote: a window no longer there was moved since (stays). */
  at: Rect;
}

/**
 * How a window's current rect was chosen (`ui-window` `data-placed`; client memory only):
 * `default` = auto placement kept its fitted default rect, `auto` = it chose another one,
 * `stored` = read from the layout entry, set by the user (move / resize end) or kept by a user
 * reopen, `pushed` = moved off a map tool bar (FR-SHELL-55), `reopened` = a user reopen found its
 * stored rect covered and auto-placed it (FR-SHELL-56), `returned` = back at its pre-push rect
 * after the tool bar went (FR-SHELL-81).
 */
export type Placed = "auto" | "stored" | "default" | "pushed" | "reopened" | "returned";

/**
 * A user open of a closed or minimised window (FR-SHELL-56): the launcher's `toggle` or `open`
 * without `by: "feature"`. `before`: the window's state before the action.
 */
export const isUserReopen = (action: WindowAction, before: WindowState["state"] | undefined) =>
  before !== undefined &&
  before !== "open" &&
  (action.type === "toggle" || (action.type === "open" && action.by !== "feature"));

/** Actions naming no window: the whole layout may change. */
export type LayoutAction = Extract<
  WindowAction,
  { type: "push" | "return" | "viewport" | "reset" }
>;

export const isLayoutAction = (a: WindowAction): a is LayoutAction =>
  a.type === "push" || a.type === "return" || a.type === "viewport" || a.type === "reset";

const sameRect = (a: Rect | undefined, b: Rect) =>
  a !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** `default` when an auto-placed `r` is the type's fitted default rect, else `auto`. */
export function placedAs(def: Placeable, r: Rect, vp: Viewport, hard: readonly Rect[] = []) {
  return sameRect(fittedDefaultRect(def, vp, hard), r) ? "default" : "auto";
}

/** The context's keep-out regions. */
const keepOutsOf = (ctx: Pick<ManagerContext, "keepOuts" | "registry" | "viewport">) =>
  ctx.keepOuts?.() ?? keepOuts(ctx.registry.client, ctx.viewport);

const softRects = (list: readonly KeepOut[]) =>
  list.filter((k) => k.kind === "soft").map((k) => k.rect);

export const windowId = (kind: string, instance: string = MAIN_INSTANCE) => `${kind}:${instance}`;

const find = (ws: Windows, kind: string, instance: string) =>
  ws.find((w) => w.kind === kind && w.instance === instance);

/** Renumber z to 1..n in current order, so it stays small and bounded. */
function normaliseZ(ws: WindowState[]): WindowState[] {
  const order = [...ws].sort((a, b) => a.z - b.z);
  const rank = new Map(order.map((w, i) => [w, i + 1]));
  return ws.map((w) => (w.z === rank.get(w) ? w : { ...w, z: rank.get(w) ?? w.z }));
}

const bound = (n: number, lo: number) => Math.max(lo, Math.min(GEOMETRY_LIMIT, Math.round(n)));

const maxZ = (ws: Windows) => ws.reduce((m, w) => Math.max(m, w.z), 0);

/** The rendered window in front: open and available, highest z. */
export function topWindow(ws: Windows, available: ReadonlySet<string>): WindowState | undefined {
  let top: WindowState | undefined;
  for (const w of ws) {
    if (w.state !== "open" || !available.has(w.kind)) continue;
    if (!top || w.z > top.z) top = w;
  }
  return top;
}

/**
 * This client's default layout (FR-SHELL-14, -50): every `defaultOpen` type auto-placed in
 * registry order (FR-SHELL-45): on token-free input (first load) its fitted default rect
 * (FR-SHELL-51) wherever that is clear of the earlier ones and the hard keep-outs; with `avoid`
 * (tokens drawn) the rank decides. The named layouts (1280×720 / ×800, 1440×900, 1600×900) are
 * play-shell §7's table.
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
 * FR-SHELL-79: `useful(def, vp, client)`: width `usefulSize.w` ?? the fitted default width;
 * height min(`usefulSize.h` ?? `minOpenH` ?? min(default h, 360), band); never below the min
 * size, never above the default.
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

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const isShown = (w: WindowState, available: ReadonlySet<string>) =>
  w.state === "open" && available.has(w.kind);

/**
 * Rendered rects (fit + clamp + grown to content, growth capped by the others and the hard
 * keep-outs, FR-SHELL-52) of the windows on screen now, plus `extra` as if on screen; unknown
 * kinds clamp only.
 */
function shownRects(ws: Windows, ctx: ManagerContext, extra?: WindowState) {
  const vp = ctx.viewport;
  const shown = ws.filter((w) => isShown(w, ctx.available));
  if (extra && !shown.includes(extra)) shown.push(extra);
  const out = new Map<WindowState, Rect>();
  const known = shown.flatMap((w) => {
    const def = ctx.registry.get(w.kind);
    if (!def) out.set(w, clampRect(w, vp));
    return def ? [{ win: w, def, needed: ctx.heights?.(windowId(w.kind, w.instance)) }] : [];
  });
  const rects = windowRects(known, vp, hardRects(keepOutsOf(ctx)));
  for (const [i, k] of known.entries()) out.set(k.win, rects[i] as Rect);
  return out;
}

/** Where a stored window renders now, among the windows on screen. */
function shownRect(ws: Windows, w: WindowState, ctx: ManagerContext): Rect {
  return shownRects(ws, ctx, w).get(w) ?? clampRect(w, ctx.viewport);
}

/** Rendered rects of the windows on screen now, except (kind, instance); defaults protected. */
function onScreen(ws: Windows, ctx: ManagerContext, kind: string, instance: string): Obstacle[] {
  const out: Obstacle[] = [];
  for (const [w, r] of shownRects(ws, ctx)) {
    if (w.kind === kind && w.instance === instance) continue;
    out.push({ ...r, protected: ctx.registry.get(w.kind)?.defaultOpen === true });
  }
  return out;
}

/**
 * A rect the shell chose for `w` (auto placement, push, viewport follow), written with `area`;
 * `userSpot` dropped (FR-SHELL-56 note, OQ-SHELL-55 B).
 */
function shellRect(w: WindowState, r: Rect, area: WindowState["area"]): WindowState {
  const { userSpot: _user, ...rest } = w;
  return { ...rest, x: r.x, y: r.y, w: r.w, h: r.h, area };
}

/**
 * Windows auto placement of (kind, instance) may auto-minimise (FR-SHELL-77): rendered, open,
 * type neither `defaultOpen` nor `fixedDefault`, not the window placed; in FR-SHELL-78's order:
 * ascending z (least recently brought to front first), ties → earlier in the entry, a window
 * placed earlier in this placement's own sequence (`late`) last.
 */
export function autoMinimiseOrder(
  ws: Windows,
  ctx: ManagerContext,
  kind: string,
  instance: string,
  late?: ReadonlySet<string>,
): WindowState[] {
  const at = new Map(ws.map((w, i) => [w, i]));
  const isLate = (w: WindowState) => (late?.has(windowId(w.kind, w.instance)) ? 1 : 0);
  return ws
    .filter((w) => {
      const d = ctx.registry.get(w.kind);
      if (!d || d.defaultOpen || d.fixedDefault || !isShown(w, ctx.available)) return false;
      return !(w.kind === kind && w.instance === instance);
    })
    .sort((a, b) => isLate(a) - isLate(b) || a.z - b.z || (at.get(a) ?? 0) - (at.get(b) ?? 0));
}

const minimised = (ws: Windows, gone: ReadonlySet<WindowState>): Windows =>
  ws.map((w) => (gone.has(w) ? { ...w, state: "minimised" as const } : w));

/**
 * Auto placement of (kind, instance) (FR-SHELL-77 (a)–(e) over FR-SHELL-45), never shorter than
 * the height it renders at (a growing window's measured content height, FR-SHELL-39):
 * (a) rank at full and useful size (FR-SHELL-79); (b) accept a spot clear of windows and hard
 * keep-outs and of every PC footprint + 4 px; (c) else, iff ranking with every auto-minimisable
 * window removed (the look-ahead) gives an accepted spot, auto-minimise the first in FR-SHELL-78's
 * order and go back to (a); (d) else shrink down to the min size, accepted when clear and PC-free;
 * (d') else the look-ahead at the min size: it helps → auto-minimise as in (c) (sprint 7 ruling: a
 * PC is covered only when no auto-minimise can prevent it); (e) else the clear spot over the
 * least PC area; none clear (screen full, FR-SHELL-47): the
 * first auto-minimisable window is auto-minimised and placement runs again; nothing left: the
 * protected last resort. Returns the windows (incl. any auto-minimised), the rect and whether it
 * is clear of the other windows.
 */
function autoPlace(
  ws: Windows,
  ctx: ManagerContext,
  kind: string,
  instance: string,
  late?: ReadonlySet<string>,
): { windows: Windows; rect: Rect; clear: boolean } | null {
  const def = ctx.registry.get(kind);
  if (!def) return null;
  const regions = keepOutsOf(ctx);
  const input = { hard: hardRects(regions), soft: softRects(regions), tokens: ctx.avoid?.() ?? [] };
  const cur = find(ws, kind, instance);
  const need = growsToContent(cur ?? {}, def) ? ctx.heights?.(windowId(kind, instance)) : undefined;
  const floor = useful(def, ctx.viewport, ctx.registry);
  const placeIn = (list: Windows, more: Partial<PlaceInput>) =>
    placeWindow(def, ctx.viewport, {
      ...input,
      windows: onScreen(list, ctx, kind, instance),
      need,
      ...more,
    });
  const park = (list: Windows, w: WindowState) => {
    ctx.onAutoMinimise?.(windowId(w.kind, w.instance), kind);
    return minimised(list, new Set([w]));
  };
  let windows = ws;
  let ahead: boolean | null = null;
  let aheadMin: boolean | null = null;
  /** The look-ahead: the same with every auto-minimisable window gone (once per floor). */
  const lookAhead = (more: Partial<PlaceInput>) => {
    const q = placeIn(
      minimised(windows, new Set(autoMinimiseOrder(windows, ctx, kind, instance, late))),
      more,
    );
    return q.clear && q.pcClear;
  };
  for (;;) {
    const p = placeIn(windows, { floor });
    if (p.clear && p.pcClear) return { windows, rect: p.rect, clear: true };
    const first = autoMinimiseOrder(windows, ctx, kind, instance, late)[0];
    // (c) The look-ahead, once: after each auto-minimise the rest are the same set, minus it.
    if (first && ahead === null) ahead = lookAhead({ floor });
    if (first && ahead) {
      windows = park(windows, first);
      continue;
    }
    const d = placeIn(windows, {});
    if (d.clear && d.pcClear) return { windows, rect: d.rect, clear: true };
    // (d') No PC-free spot even shrunk: the look-ahead again at the min size, so a window is
    // auto-minimised rather than a PC covered (#310) whenever that can help.
    if (first && aheadMin === null) aheadMin = lookAhead({});
    if (first && aheadMin) {
      windows = park(windows, first);
      continue;
    }
    const e = placeIn(windows, { leastPc: true });
    if (e.clear) return { windows, rect: e.rect, clear: true };
    if (first) {
      windows = park(windows, first);
      continue;
    }
    const last = placeIn(windows, { leastPc: true, lastResort: true });
    return { windows, rect: last.rect, clear: last.clear };
  }
}

/** `ws` with (kind, instance) auto-placed (and any window auto-minimised for it), written. */
function withAutoPlaced(
  ws: Windows,
  ctx: ManagerContext,
  kind: string,
  instance: string,
  late?: ReadonlySet<string>,
): Windows {
  const placed = autoPlace(ws, ctx, kind, instance, late);
  if (!placed) return ws;
  const area = workArea(ctx.viewport);
  return patch(placed.windows, kind, instance, (w) => shellRect(w, placed.rect, area));
}

/**
 * Covered (FR-SHELL-56 (2), OQ-SHELL-41 A): the window's shown rect (stored geometry as it would
 * render now: fit, clamp, grown height) overlaps, by ≥ 1 px, another rendered open window or a
 * hard keep-out region. The DM's soft box and tokens don't count.
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
 * FR-SHELL-56 (5): a protected window reopened onto a covered spot keeps it; every other open
 * window overlapping its shown rect is auto-placed as if just opened (FR-SHELL-77; the protected
 * one an obstacle, the ones moved before it last in FR-SHELL-78's order), lowest z first,
 * written; one still not clear of the windows is auto-minimised (FR-SHELL-47). Protected and
 * `fixedDefault` ones are moved only when a clear spot exists.
 */
function clearAround(ws: Windows, ctx: ManagerContext, kind: string, instance: string): Windows {
  const me = find(ws, kind, instance);
  if (!me) return ws;
  const mine = shownRect(ws, me, ctx);
  const covering = [...shownRects(ws, ctx)]
    .filter(([w, r]) => w !== me && overlaps(mine, r))
    .map(([w]) => w)
    .sort((a, b) => a.z - b.z);
  const regions = keepOutsOf(ctx);
  const input = { hard: hardRects(regions), soft: softRects(regions), tokens: ctx.avoid?.() ?? [] };
  const area = workArea(ctx.viewport);
  const late = new Set([windowId(kind, instance)]);
  let out = ws;
  for (const w of covering) {
    const def = ctx.registry.get(w.kind);
    const now = find(out, w.kind, w.instance);
    if (!def || def.fixedDefault || !now || !isShown(now, ctx.available)) continue;
    if (!def.defaultOpen) {
      const placed = autoPlace(out, ctx, w.kind, w.instance, late);
      if (!placed) continue;
      out = placed.clear
        ? patch(placed.windows, w.kind, w.instance, (x) => shellRect(x, placed.rect, area))
        : patch(out, w.kind, w.instance, (x) => ({ ...x, state: "minimised" }));
      late.add(windowId(w.kind, w.instance));
      continue;
    }
    const others = onScreen(out, ctx, w.kind, w.instance);
    const need = growsToContent(w, def) ? ctx.heights?.(windowId(w.kind, w.instance)) : undefined;
    const p = placeWindow(def, ctx.viewport, { ...input, windows: others, need });
    if (p.clear) out = patch(out, w.kind, w.instance, (x) => shellRect(x, p.rect, area));
  }
  return out;
}

/**
 * A stored window a feature brings up (feature open, appearance) is auto-placed when it would
 * cover a window on screen or a hard keep-out region (FR-SHELL-41, -48) or sits at a rect the
 * user didn't choose: auto-placed on this page, or at its default-layout / fitted default rect
 * (FR-SHELL-40).
 */
function needsAutoPlace(ws: Windows, cur: WindowState, ctx: ManagerContext): boolean {
  const def = ctx.registry.get(cur.kind);
  if (!def) return false;
  if (isCovered(ws, cur, ctx)) return true;
  const hard = hardRects(keepOutsOf(ctx));
  const how = ctx.placed?.(windowId(cur.kind, cur.instance));
  if (how === "auto" || how === "default" || how === "pushed") return true;
  // OQ-SHELL-55 B: a spot the shell chose (a returned one included) over a PC is re-placed.
  if (!cur.userSpot && (how === "returned" || isReopenCovered(ws, cur, ctx))) return true;
  const asDefault = defaultLayout(ctx.registry, ctx.viewport).find((w) => w.kind === cur.kind);
  return sameRect(asDefault, cur) || sameRect(fittedDefaultRect(def, ctx.viewport, hard), cur);
}

export interface Restored {
  windows: WindowState[];
  /** Set when the stored entry was invalid; the caller logs it (no error UI, FR-SHELL-17). */
  warning?: string;
  /** The windows come from the stored entry (else: the default layout). */
  stored?: true;
  /** Default-sized windows took this viewport's default (FR-SHELL-53): write the entry. */
  migrated?: true;
}

/**
 * FR-SHELL-53: a stored window whose size equals one of its type's default sizes (any viewport
 * class) or `previousDefaults`, never resized by the user, takes the current viewport's default
 * size: at its stored position if that rect is inside the work area and clear of the other open
 * windows and the hard keep-outs, else auto-placed; written with `area`.
 */
function followDefaults(
  windows: WindowState[],
  registry: WindowRegistry,
  vp: Viewport,
  regions: readonly KeepOut[],
): boolean {
  const hard = hardRects(regions);
  let changed = false;
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i] as WindowState;
    const def = registry.get(w.kind);
    if (!def || w.fixedH) continue;
    if (!knownDefaultSizes(def).some((s) => s.w === w.w && s.h === w.h)) continue;
    const size = defaultSizeAt(def, vp);
    if (size.w === w.w && size.h === w.h) continue;
    const others: Obstacle[] = [];
    for (const o of windows) {
      const d = registry.get(o.kind);
      if (o === w || o.state !== "open" || !d) continue;
      others.push({ ...renderedRect(o, d.minSize, vp), protected: d.defaultOpen === true });
    }
    const keep = { x: w.x, y: w.y, ...size };
    const inside =
      keep.x >= 0 &&
      keep.y >= TOP_BAR_H &&
      keep.x + keep.w <= vp.w &&
      keep.y + keep.h <= vp.h - LAUNCHER_CLEAR;
    const clear = ![...others, ...hard].some((o) => overlaps(keep, o));
    windows[i] =
      inside && clear
        ? { ...w, ...keep, area: workArea(vp) }
        : shellRect(
            w,
            placeWindow(def, vp, { windows: others, hard, soft: softRects(regions) }).rect,
            workArea(vp),
          );
    changed = true;
  }
  return changed;
}

/**
 * A live viewport change (FR-SHELL-51, -53; W2 walkthrough, #269): the same follow as applying
 * the entry, so a never-resized Game log at 1150×240 takes 690×160 at 1280×720 without a reload.
 * Other windows keep their stored rect (render-only fit and clamp, FR-SHELL-29). Same array when
 * nothing follows.
 */
export function followViewport(
  ws: Windows,
  registry: WindowRegistry,
  vp: Viewport,
  regions: readonly KeepOut[] = keepOuts(registry.client, vp),
): Windows {
  const windows = [...ws];
  return followDefaults(windows, registry, vp, regions) ? windows : ws;
}

/**
 * FR-SHELL-55: every rendered open window overlapping `bar` grown by 12 px is pushed right, in x
 * order: x = the bar's right edge + 12, then past each open window it lands on (its right edge +
 * 12), repeatedly; same y and height; its width kept if it fits before vw − 12, else shrunk toward
 * its min. No room to the right even at min width: it moves below the bar (`belowBar`). Neither
 * fits: a launcher window is auto-minimised (FR-SHELL-47), a protected (`defaultOpen`) or
 * `fixedDefault` one goes to the right edge at min width. Written with `area`; the shell keeps
 * the pre-push rect for `return` (FR-SHELL-81).
 */
function pushWindows(ws: Windows, bar: Rect, ctx: ManagerContext): Windows {
  const vp = ctx.viewport;
  const grown = {
    x: bar.x - EDGE_GAP,
    y: bar.y - EDGE_GAP,
    w: bar.w + 2 * EDGE_GAP,
    h: bar.h + 2 * EDGE_GAP,
  };
  const shown = [...shownRects(ws, ctx)];
  const hit = shown
    .filter(([, r]) => overlaps(r, grown))
    .sort(([a, ra], [b, rb]) => ra.x - rb.x || ra.y - rb.y || a.z - b.z);
  if (hit.length === 0) return ws;
  const moving = new Set(hit.map(([w]) => w));
  // Where the others are now: windows not pushed, then each pushed one at its new rect.
  const taken = shown.filter(([w]) => !moving.has(w)).map(([, r]) => r);
  const right = vp.w - EDGE_GAP;
  const area = workArea(vp);
  let out = ws;
  for (const [win, r] of hit) {
    const def = ctx.registry.get(win.kind);
    if (!def) continue;
    const min = Math.min(def.minSize.w, r.w);
    let x = bar.x + bar.w + EDGE_GAP;
    let landed: Rect | null = null;
    while (x + min <= right) {
      const cand = { ...r, x, w: Math.min(r.w, right - x) };
      const on = taken.filter((o) => overlaps(cand, o));
      if (on.length === 0) {
        landed = cand;
        break;
      }
      x = Math.max(...on.map((o) => o.x + o.w)) + EDGE_GAP;
    }
    const base = renderedRect(win, def.minSize, vp); // stored height: growth is never written
    const under = landed ? null : belowBar({ ...r, h: base.h }, def.minSize.h, bar, taken, vp);
    if (!landed && !under && !def.defaultOpen && !def.fixedDefault) {
      out = patch(out, win.kind, win.instance, (w) => ({ ...w, state: "minimised" }));
      continue;
    }
    const at = landed ?? under ?? { ...r, x: right - min, w: min };
    taken.push(at);
    const stored = under ?? { x: at.x, y: base.y, w: at.w, h: base.h };
    out = patch(out, win.kind, win.instance, (w) => shellRect(w, stored, area));
  }
  return out;
}

/**
 * FR-SHELL-81: when the tool bar goes, every window still open at the rect its push wrote goes
 * back to its pre-push rect, lowest z first, iff that rect (as it renders now) is clear of every
 * other rendered open window and hard keep-out region; PCs don't count (like a user spot). Written
 * with `area` and the `userSpot` it had; any other stays where it was pushed.
 */
function returnPushed(ws: Windows, ctx: ManagerContext): Windows {
  const area = workArea(ctx.viewport);
  const back = (ctx.prePush?.() ?? [])
    .map((p) => ({ p, w: find(ws, p.kind, p.instance) }))
    .filter(
      (e): e is { p: PrePush; w: WindowState } =>
        e.w !== undefined && isShown(e.w, ctx.available) && sameRect(e.w, e.p.at),
    )
    .sort((a, b) => a.w.z - b.w.z);
  let out = ws;
  for (const { p } of back) {
    const moved = patch(out, p.kind, p.instance, (w) => ({
      ...shellRect(w, p.rect, area),
      ...(p.userSpot && { userSpot: true as const }),
    }));
    const me = find(moved, p.kind, p.instance);
    if (!me || moved === out) continue;
    const shown = shownRect(moved, me, ctx);
    const blocked = [...onScreen(moved, ctx, p.kind, p.instance), ...hardRects(keepOutsOf(ctx))];
    if (!blocked.some((o) => overlaps(shown, o))) out = moved;
  }
  return out;
}

/**
 * FR-SHELL-55 (orchestrator ruling, W3): a pushed window with no room right of the bar goes below
 * it: top = the bar's bottom + 12, same width, at the x nearest its own column (its x, else
 * beside a window it would land on; never under the rail) where it lands on no other window;
 * its height kept, else shrunk to the clear space above the next window / the usable bottom,
 * never below `minH`. Null when nothing fits.
 */
function belowBar(
  r: Rect,
  minH: number,
  bar: Rect,
  taken: readonly Rect[],
  vp: Viewport,
): Rect | null {
  const usable = usableArea(vp);
  const top = bar.y + bar.h + EDGE_GAP;
  const xs = [r.x, ...taken.flatMap((o) => [o.x - EDGE_GAP - r.w, o.x + o.w + EDGE_GAP])]
    .filter((x) => x >= RAIL_CLEAR && x + r.w <= usable.right)
    .sort((a, b) => Math.abs(a - r.x) - Math.abs(b - r.x) || a - b);
  for (const x of xs) {
    let bottom = usable.bottom;
    let blocked = false;
    for (const o of taken) {
      if (o.x >= x + r.w || x >= o.x + o.w) continue;
      if (o.y + o.h <= top) continue; // above the slot
      if (o.y < top + minH) {
        blocked = true; // spans the slot's top
        break;
      }
      bottom = Math.min(bottom, o.y - EDGE_GAP);
    }
    const h = Math.min(r.h, bottom - top);
    if (!blocked && h >= minH) return { x, y: top, w: r.w, h };
  }
  return null;
}

/**
 * Builds state from a stored entry (FR-SHELL-16/17/18). `raw` = the stored string, or null.
 * Missing → default; bad JSON or schema → default + warning. Unknown kinds are kept in memory
 * (skipped when rendering) and dropped at the next write by `serialise`. A type with
 * `restoreOpen: false` loads closed, its geometry kept (FR-SHELL-42). Default-sized windows
 * follow the viewport (FR-SHELL-53).
 */
export function restoreLayout(
  registry: WindowRegistry,
  raw: string | null,
  vp: Viewport,
  avoid: readonly PlacementToken[] = [],
  regions: readonly KeepOut[] = keepOuts(registry.client, vp),
): Restored {
  const fresh = () => defaultLayout(registry, vp, avoid, regions);
  if (raw === null) return { windows: fresh() };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { windows: fresh(), warning: "layout entry is not JSON" };
  }
  const parsed = Layout.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      windows: fresh(),
      warning: `layout entry invalid (${first?.path.join(".")}: ${first?.message})`,
    };
  }
  const windows = parsed.data.windows.map((w) =>
    w.state !== "closed" && registry.get(w.kind)?.restoreOpen === false
      ? { ...w, state: "closed" as const }
      : w,
  );
  const migrated = followDefaults(windows, registry, vp, regions);
  return { windows: normaliseZ(windows), stored: true, ...(migrated && { migrated: true }) };
}

/** What gets written: unknown kinds dropped, unavailable ones kept (FR-SHELL-18). */
export function serialise(ws: Windows, registry: WindowRegistry): Layout {
  return { windows: ws.filter((w) => registry.get(w.kind) !== undefined).map((w) => ({ ...w })) };
}

function patch(
  ws: Windows,
  kind: string,
  instance: string,
  fn: (w: WindowState) => WindowState,
): Windows {
  const cur = find(ws, kind, instance);
  if (!cur) return ws;
  const next = fn(cur);
  if (
    next.state === cur.state &&
    next.x === cur.x &&
    next.y === cur.y &&
    next.w === cur.w &&
    next.h === cur.h &&
    next.z === cur.z &&
    next.area?.w === cur.area?.w &&
    next.area?.h === cur.area?.h &&
    next.fixedH === cur.fixedH &&
    next.userSpot === cur.userSpot
  ) {
    return ws;
  }
  return ws.map((w) => (w === cur ? next : w));
}

function toFront(ws: Windows, kind: string, instance: string, state?: WindowState["state"]) {
  const cur = find(ws, kind, instance);
  if (!cur) return ws;
  const isTop = cur.z === maxZ(ws);
  if (isTop && (state === undefined || state === cur.state)) return ws;
  return normaliseZ(
    ws.map((w) => (w === cur ? { ...w, state: state ?? w.state, z: maxZ(ws) + 1 } : w)),
  );
}

/**
 * Returns the next windows, or the same array when nothing changed (no write then).
 * Every change returned here is one of the FR-SHELL-15 writes.
 */
export function reduce(ws: Windows, action: WindowAction, ctx: ManagerContext): Windows {
  if (action.type === "reset") {
    // FR-SHELL-80: exactly the named (token-free) default layout; the map refits instead.
    return defaultLayout(ctx.registry, ctx.viewport, [], keepOutsOf(ctx));
  }
  if (action.type === "push") return pushWindows(ws, action.rect, ctx);
  if (action.type === "return") return returnPushed(ws, ctx);
  if (action.type === "viewport") {
    return followViewport(ws, ctx.registry, ctx.viewport, keepOutsOf(ctx));
  }
  const instance = action.instance ?? MAIN_INSTANCE;
  const { kind } = action;
  const def = ctx.registry.get(kind);
  if (!def) return ws; // unknown kind: never opened or changed

  switch (action.type) {
    case "open": {
      // FR-SHELL-08: last geometry, else auto placement (FR-SHELL-45); front; minimised →
      // restored. A feature open never lands on another window (FR-SHELL-41); a user reopen
      // keeps the stored rect unless it is covered (FR-SHELL-56). Already open: front only.
      const cur = find(ws, kind, instance);
      if (cur) {
        let next = ws;
        if (cur.state !== "open" && ctx.available.has(kind)) {
          if (action.by === "feature") {
            if (needsAutoPlace(ws, cur, ctx)) next = withAutoPlaced(ws, ctx, kind, instance);
          } else if (!def.fixedDefault && isReopenCovered(ws, cur, ctx)) {
            if (!def.defaultOpen) next = withAutoPlaced(ws, ctx, kind, instance);
            else {
              const opened = patch(ws, kind, instance, (w) => ({ ...w, state: "open" }));
              next = clearAround(opened, ctx, kind, instance);
            }
          }
        }
        return toFront(next, kind, instance, "open");
      }
      const added = {
        kind,
        instance,
        state: "open" as const,
        ...fittedDefaultRect(def, ctx.viewport),
      };
      const next = [...ws, { ...added, z: maxZ(ws) + 1, area: workArea(ctx.viewport) }];
      return normaliseZ([...withAutoPlaced(next, ctx, kind, instance)]);
    }
    case "close":
      return patch(ws, kind, instance, (w) => ({ ...w, state: "closed" }));
    case "minimise":
      return patch(ws, kind, instance, (w) => ({ ...w, state: "minimised" }));
    case "focus": {
      const cur = find(ws, kind, instance);
      if (cur?.state !== "open") return ws;
      return toFront(ws, kind, instance);
    }
    case "toggle": {
      // FR-SHELL-09: closed/minimised → open + front; behind → front; on top → minimise.
      const cur = find(ws, kind, instance);
      if (cur?.state !== "open") return reduce(ws, { type: "open", kind, instance }, ctx);
      const top = topWindow(ws, ctx.available);
      if (top === cur) return reduce(ws, { type: "minimise", kind, instance }, ctx);
      return toFront(ws, kind, instance);
    }
    case "appear": {
      const cur = find(ws, kind, instance);
      if (cur?.state !== "open" || !ctx.available.has(kind)) return ws;
      if (!needsAutoPlace(ws, cur, ctx)) return ws;
      return withAutoPlaced(ws, ctx, kind, instance);
    }
    case "settle": {
      const cur = find(ws, kind, instance);
      if (cur?.state !== "open" || !ctx.available.has(kind)) return ws;
      if (ctx.placed?.(windowId(kind, instance)) === "stored") return ws;
      const shown = shownRect(ws, cur, ctx);
      const blocked = [...onScreen(ws, ctx, kind, instance), ...hardRects(keepOutsOf(ctx))];
      const covers = blocked.some((o) => overlaps(shown, o));
      if (!covers && shown.h <= cur.h) return ws;
      return withAutoPlaced(ws, ctx, kind, instance);
    }
    case "setRect": {
      const r = action.rect;
      // OQ-SHELL-55 B: a move / resize end makes the spot the user's (`userSpot`).
      return patch(ws, kind, instance, (w) => ({
        ...w,
        x: bound(r.x, -GEOMETRY_LIMIT),
        y: bound(r.y, -GEOMETRY_LIMIT),
        w: bound(Math.max(def.minSize.w, r.w), 1),
        h: bound(Math.max(def.minSize.h, r.h), 1),
        area: workArea(ctx.viewport),
        // FR-SHELL-39: after a user resize the stored height wins (cleared by reset).
        ...(action.resized && def.growToContent && { fixedH: true as const }),
        userSpot: true as const,
      }));
    }
  }
}

/**
 * Windows mounted now (FR-SHELL-36): open ones shown, minimised ones parked (mounted, hidden,
 * state kept). Closed windows and unavailable kinds are unmounted whatever their state.
 */
export function mountedWindows(ws: Windows, available: ReadonlySet<string>): WindowState[] {
  return ws.filter((w) => w.state !== "closed" && available.has(w.kind));
}

export type LauncherState = "open" | "minimised" | "closed";

export function launcherState(ws: Windows, kind: string, instance = MAIN_INSTANCE): LauncherState {
  return find(ws, kind, instance)?.state ?? "closed";
}

/** Launcher button Tooltip per state (FR-SHELL-37). */
export function launcherTooltip(label: string, state: LauncherState): string {
  if (state === "open") return `${label} (open)`;
  if (state === "minimised") return `${label} (minimised — click to restore)`;
  return label;
}
