// Window manager reducer (FR-SHELL-08–12, 14, 16–18, 29, 40–42). Pure: no DOM, no storage.
// Holds every window's *stored* state; rendering fits and clamps (geometry.ts) without writing
// back. Every geometry it sets is stamped with the work area it was set in (`area`).
import { GEOMETRY_LIMIT, Layout, MAIN_INSTANCE, type WindowState } from "@shared/play-shell/layout";
import {
  clampRect,
  growsToContent,
  type Rect,
  type Viewport,
  windowRect,
  workArea,
} from "./geometry";
import { fittedDefaultRect, placeRect } from "./placement";
import type { WindowRegistry } from "./registry";
import { toastKeepOut } from "./toast-region";

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
  | { type: "reset" };

export interface ManagerContext {
  registry: WindowRegistry;
  viewport: Viewport;
  /** Kinds rendered right now (registered + available). */
  available: ReadonlySet<string>;
  /** On-screen map token boxes an auto-placed window covers the least of (FR-SHELL-40). */
  avoid?: () => readonly Rect[];
  /** How a window's current rect was chosen, if known on this page (`data-placed`). */
  placed?: (id: string) => Placed | undefined;
  /** Measured content height of a `growToContent` window (FR-SHELL-39), by window id. */
  heights?: (id: string) => number | undefined;
}

/**
 * How a window's current rect was chosen (`ui-window` `data-placed`; client memory only):
 * `default` = auto placement kept its fitted default rect, `auto` = it chose another one,
 * `stored` = read from the layout entry or set by the user (move / resize end).
 */
export type Placed = "auto" | "stored" | "default";

const sameRect = (a: Rect | undefined, b: Rect) =>
  a !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** `default` when an auto-placed `r` is the type's fitted default rect, else `auto`. */
export function placedAs(def: Parameters<typeof fittedDefaultRect>[0], r: Rect, vp: Viewport) {
  return sameRect(fittedDefaultRect(def, vp), r) ? "default" : "auto";
}

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
 * This client's default layout: every `defaultOpen` type auto-placed in registry order
 * (FR-SHELL-14, -40): its fitted default rect unless that overlaps an earlier one, or covers
 * more of `avoid` (on-screen token boxes; none drawn on first load) or of the toast keep-out box.
 */
export function defaultLayout(
  registry: WindowRegistry,
  vp: Viewport,
  avoid: readonly Rect[] = [],
): WindowState[] {
  const keepOut = toastKeepOut(registry.client, vp);
  const out: WindowState[] = [];
  for (const d of registry.defs) {
    if (!d.defaultOpen) continue;
    out.push({
      kind: d.kind,
      instance: MAIN_INSTANCE,
      state: "open",
      ...placeRect(d, vp, out, avoid, keepOut),
      z: out.length + 1,
      area: workArea(vp),
    });
  }
  return out;
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where a stored window renders now (fit + clamp + grown to content); unknown kinds clamp only. */
function shownRect(w: WindowState, ctx: ManagerContext): Rect {
  const def = ctx.registry.get(w.kind);
  if (!def) return clampRect(w, ctx.viewport);
  return windowRect(w, def, ctx.viewport, ctx.heights?.(windowId(w.kind, w.instance)));
}

/** Rendered rects of the windows on screen now, except (kind, instance). */
function onScreen(ws: Windows, ctx: ManagerContext, kind: string, instance: string): Rect[] {
  return ws
    .filter(
      (w) =>
        w.state === "open" &&
        ctx.available.has(w.kind) &&
        !(w.kind === kind && w.instance === instance),
    )
    .map((w) => shownRect(w, ctx));
}

/**
 * Auto placement of (kind, instance) against what is on screen now (FR-SHELL-40), never shorter
 * than the height it renders at: a growing window's measured content height (FR-SHELL-39).
 */
function autoRect(ws: Windows, ctx: ManagerContext, kind: string, instance: string): Rect | null {
  const def = ctx.registry.get(kind);
  if (!def) return null;
  const vp = ctx.viewport;
  const others = onScreen(ws, ctx, kind, instance);
  const cur = find(ws, kind, instance);
  const need = growsToContent(cur ?? {}, def) ? ctx.heights?.(windowId(kind, instance)) : undefined;
  const keepOut = toastKeepOut(ctx.registry.client, vp);
  return placeRect(def, vp, others, ctx.avoid?.() ?? [], keepOut, need);
}

/**
 * A stored window a feature brings up (feature open, appearance) is auto-placed when it would
 * cover a window on screen (FR-SHELL-41) or sits at a rect the user didn't choose: auto-placed
 * on this page, or at its default-layout / fitted default rect (FR-SHELL-40).
 */
function needsAutoPlace(ws: Windows, cur: WindowState, ctx: ManagerContext): boolean {
  const def = ctx.registry.get(cur.kind);
  if (!def) return false;
  const shown = shownRect(cur, ctx);
  if (onScreen(ws, ctx, cur.kind, cur.instance).some((o) => overlaps(shown, o))) return true;
  const how = ctx.placed?.(windowId(cur.kind, cur.instance));
  if (how === "auto" || how === "default") return true;
  const asDefault = defaultLayout(ctx.registry, ctx.viewport).find((w) => w.kind === cur.kind);
  return sameRect(asDefault, cur) || sameRect(fittedDefaultRect(def, ctx.viewport), cur);
}

export interface Restored {
  windows: WindowState[];
  /** Set when the stored entry was invalid; the caller logs it (no error UI, FR-SHELL-17). */
  warning?: string;
  /** The windows come from the stored entry (else: the default layout). */
  stored?: true;
}

/**
 * Builds state from a stored entry (FR-SHELL-16/17/18). `raw` = the stored string, or null.
 * Missing → default; bad JSON or schema → default + warning. Unknown kinds are kept in memory
 * (skipped when rendering) and dropped at the next write by `serialise`. A type with
 * `restoreOpen: false` loads closed, its geometry kept (FR-SHELL-42).
 */
export function restoreLayout(
  registry: WindowRegistry,
  raw: string | null,
  vp: Viewport,
  avoid: readonly Rect[] = [],
): Restored {
  if (raw === null) return { windows: defaultLayout(registry, vp, avoid) };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { windows: defaultLayout(registry, vp, avoid), warning: "layout entry is not JSON" };
  }
  const parsed = Layout.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      windows: defaultLayout(registry, vp, avoid),
      warning: `layout entry invalid (${first?.path.join(".")}: ${first?.message})`,
    };
  }
  const windows = parsed.data.windows.map((w) =>
    w.state !== "closed" && registry.get(w.kind)?.restoreOpen === false
      ? { ...w, state: "closed" as const }
      : w,
  );
  return { windows: normaliseZ(windows), stored: true };
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
  if (action.type === "reset") return defaultLayout(ctx.registry, ctx.viewport, ctx.avoid?.());
  const instance = action.instance ?? MAIN_INSTANCE;
  const { kind } = action;
  const def = ctx.registry.get(kind);
  if (!def) return ws; // unknown kind: never opened or changed

  switch (action.type) {
    case "open": {
      // FR-SHELL-08: last geometry, else auto placement (FR-SHELL-40); front; minimised →
      // restored. A feature open never lands on another window (FR-SHELL-41).
      const area = workArea(ctx.viewport);
      const cur = find(ws, kind, instance);
      if (cur) {
        let next = ws;
        const feature = action.by === "feature" && cur.state !== "open";
        if (feature && ctx.available.has(kind) && needsAutoPlace(ws, cur, ctx)) {
          const rect = autoRect(ws, ctx, kind, instance);
          if (rect) next = patch(ws, kind, instance, (w) => ({ ...w, ...rect, area }));
        }
        return toFront(next, kind, instance, "open");
      }
      const rect = autoRect(ws, ctx, kind, instance) ?? fittedDefaultRect(def, ctx.viewport);
      return normaliseZ([...ws, { kind, instance, state: "open", ...rect, z: maxZ(ws) + 1, area }]);
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
      const rect = autoRect(ws, ctx, kind, instance);
      if (!rect) return ws;
      return patch(ws, kind, instance, (w) => ({ ...w, ...rect, area: workArea(ctx.viewport) }));
    }
    case "settle": {
      const cur = find(ws, kind, instance);
      if (cur?.state !== "open" || !ctx.available.has(kind)) return ws;
      if (ctx.placed?.(windowId(kind, instance)) === "stored") return ws;
      const shown = shownRect(cur, ctx);
      const covers = onScreen(ws, ctx, kind, instance).some((o) => overlaps(shown, o));
      if (!covers && shown.h <= cur.h) return ws;
      const rect = autoRect(ws, ctx, kind, instance);
      if (!rect) return ws;
      return patch(ws, kind, instance, (w) => ({ ...w, ...rect, area: workArea(ctx.viewport) }));
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
