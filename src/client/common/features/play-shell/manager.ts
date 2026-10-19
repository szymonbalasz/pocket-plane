// Window manager reducer (FR-SHELL-08–12, 14, 16–18, 29, 40–42, 45–53, 55). Pure: no DOM, no
// storage. Holds every window's *stored* state; rendering fits and clamps (geometry.ts) without
// writing back. Every geometry it sets is stamped with the work area it was set in (`area`).
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
  type PlacementToken,
  placeWindow,
  RAIL_CLEAR,
  usableArea,
} from "./placement";
import { defaultSizeAt, knownDefaultSizes, type WindowRegistry } from "./registry";

export type Windows = readonly WindowState[];

/**
 * Who opens a window (FR-SHELL-08): `user` (a click; the default) reopens at the stored rect;
 * `feature` (a feature on its own, e.g. Initiative at Start) never lands on another window.
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
   * are pushed right of it, written; nothing moves back when it goes.
   */
  | { type: "push"; rect: Rect }
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
}

/**
 * How a window's current rect was chosen (`ui-window` `data-placed`; client memory only):
 * `default` = auto placement kept its fitted default rect, `auto` = it chose another one,
 * `stored` = read from the layout entry or set by the user (move / resize end), `pushed` = moved
 * off a map tool bar (FR-SHELL-55).
 */
export type Placed = "auto" | "stored" | "default" | "pushed";

/** Actions naming no window: the whole layout may change. */
export type LayoutAction = Extract<WindowAction, { type: "push" | "viewport" | "reset" }>;

export const isLayoutAction = (a: WindowAction): a is LayoutAction =>
  a.type === "push" || a.type === "viewport" || a.type === "reset";

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
 * Auto placement of (kind, instance) against what is on screen now (FR-SHELL-45), never shorter
 * than the height it renders at: a growing window's measured content height (FR-SHELL-39).
 * Screen full (FR-SHELL-47): the least recently used launcher-opened window (open, type neither
 * `defaultOpen` nor `fixedDefault`; lowest z) is minimised and placement runs again, repeatedly.
 * Returns the windows (incl. any auto-minimised) and the rect.
 */
function autoPlace(
  ws: Windows,
  ctx: ManagerContext,
  kind: string,
  instance: string,
): { windows: Windows; rect: Rect } | null {
  const def = ctx.registry.get(kind);
  if (!def) return null;
  const regions = keepOutsOf(ctx);
  const input = { hard: hardRects(regions), soft: softRects(regions), tokens: ctx.avoid?.() ?? [] };
  const cur = find(ws, kind, instance);
  const need = growsToContent(cur ?? {}, def) ? ctx.heights?.(windowId(kind, instance)) : undefined;
  let windows = ws;
  for (;;) {
    const others = onScreen(windows, ctx, kind, instance);
    const p = placeWindow(def, ctx.viewport, { ...input, windows: others, need });
    if (p.clear) return { windows, rect: p.rect };
    let lru: WindowState | undefined;
    for (const w of windows) {
      const d = ctx.registry.get(w.kind);
      if (!d || d.defaultOpen || d.fixedDefault || !isShown(w, ctx.available)) continue;
      if (w.kind === kind && w.instance === instance) continue;
      if (!lru || w.z < lru.z) lru = w;
    }
    if (!lru) {
      const last = placeWindow(def, ctx.viewport, {
        ...input,
        windows: others,
        need,
        lastResort: true,
      });
      return { windows, rect: last.rect };
    }
    const parked = lru;
    windows = windows.map((w) => (w === parked ? { ...w, state: "minimised" as const } : w));
  }
}

/** `ws` with (kind, instance) auto-placed (and any window auto-minimised for it), written. */
function withAutoPlaced(ws: Windows, ctx: ManagerContext, kind: string, instance: string): Windows {
  const placed = autoPlace(ws, ctx, kind, instance);
  if (!placed) return ws;
  const area = workArea(ctx.viewport);
  return patch(placed.windows, kind, instance, (w) => ({ ...w, ...placed.rect, area }));
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
  const shown = shownRect(ws, cur, ctx);
  if (onScreen(ws, ctx, cur.kind, cur.instance).some((o) => overlaps(shown, o))) return true;
  const hard = hardRects(keepOutsOf(ctx));
  if (hard.some((k) => overlaps(shown, k))) return true;
  const how = ctx.placed?.(windowId(cur.kind, cur.instance));
  if (how === "auto" || how === "default" || how === "pushed") return true;
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
    const rect =
      inside && clear
        ? keep
        : placeWindow(def, vp, { windows: others, hard, soft: softRects(regions) }).rect;
    windows[i] = { ...w, ...rect, area: workArea(vp) };
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
 * `fixedDefault` one goes to the right edge at min width. Written with `area`; never restored.
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
    out = patch(out, win.kind, win.instance, (w) => ({ ...w, ...stored, area }));
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
    next.fixedH === cur.fixedH
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
    return defaultLayout(ctx.registry, ctx.viewport, ctx.avoid?.(), keepOutsOf(ctx));
  }
  if (action.type === "push") return pushWindows(ws, action.rect, ctx);
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
      // restored. A feature open never lands on another window (FR-SHELL-41).
      const cur = find(ws, kind, instance);
      if (cur) {
        let next = ws;
        const feature = action.by === "feature" && cur.state !== "open";
        if (feature && ctx.available.has(kind) && needsAutoPlace(ws, cur, ctx)) {
          next = withAutoPlaced(ws, ctx, kind, instance);
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
      return patch(ws, kind, instance, (w) => ({
        ...w,
        x: bound(r.x, -GEOMETRY_LIMIT),
        y: bound(r.y, -GEOMETRY_LIMIT),
        w: bound(Math.max(def.minSize.w, r.w), 1),
        h: bound(Math.max(def.minSize.h, r.h), 1),
        area: workArea(ctx.viewport),
        // FR-SHELL-39: after a user resize the stored height wins (cleared by reset).
        ...(action.resized && def.growToContent && { fixedH: true as const }),
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
