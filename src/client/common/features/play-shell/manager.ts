// Window manager reducer (FR-SHELL-08–12, 14, 16–18, 29, 40–42, 95). Pure: no DOM, no storage.
// Holds every window's *stored* state; rendering fits and clamps (geometry.ts) without writing
// back. State changes (open, close, minimise, focus, a move / resize end) are made here; every
// rect the shell chooses comes from the one placer (`placer.ts`, FR-SHELL-95, ADR-0060), stamped
// with the work area it was set in (`area`). A move / resize end sets `userSpot` / `userSize`
// (remembered, FR-SHELL-144: the placer never writes it again); only Reset clears them.
import { GEOMETRY_LIMIT, Layout, MAIN_INSTANCE, type WindowState } from "@shared/play-shell/layout";
import { isRemembered, type Rect, type Viewport, workArea } from "./geometry";
import { type KeepOut, keepOuts } from "./keep-outs";
import { fittedDefaultRect, type PlacementToken } from "./placement";
import {
  type Displacement,
  defaultLayout,
  find,
  inferUserSize,
  type ManagerContext,
  maxZ,
  normaliseZ,
  type OpenBy,
  type Plan,
  settle,
  type Trigger,
  type Windows,
  windowId,
} from "./placer";
import type { WindowRegistry } from "./registry";

export {
  autoMinimiseOrder,
  bandAt,
  type Displacement,
  type DryFit,
  defaultLayout,
  isCovered,
  isReopenCovered,
  type ManagerContext,
  type OpenBy,
  type Placed,
  type Plan,
  persistable,
  placedAs,
  pushBars,
  renderedPlaced,
  USEFUL_H,
  useful,
  usefulSize,
  type Windows,
  windowId,
} from "./placer";

export type WindowAction =
  | { type: "open"; kind: string; instance?: string; by?: OpenBy }
  | { type: "close"; kind: string; instance?: string }
  | { type: "minimise"; kind: string; instance?: string }
  | { type: "focus"; kind: string; instance?: string }
  | { type: "toggle"; kind: string; instance?: string }
  /**
   * Move / resize end (the placer's `drag-end`). `resized`: a user resize: sets `userSize`, and
   * `fixedH` on a `growToContent` type.
   */
  | { type: "setRect"; kind: string; instance?: string; rect: Rect; resized?: boolean }
  /** The kind just became available (e.g. player `cbt.initiative` on Start): FR-SHELL-107. */
  | { type: "appear"; kind: string; instance?: string }
  /** First layout of a window the shell placed: its real height is known (FR-SHELL-40, -41). */
  | { type: "settle"; kind: string; instance?: string }
  /** A map tool bar appeared at `rect` (viewport px) or changed size (FR-SHELL-55). */
  | { type: "push"; rect: Rect }
  /**
   * A cause may have ended (a keep-out went, a kind became unavailable): what it displaced
   * returns (FR-SHELL-102).
   */
  | { type: "return" }
  /** The viewport settled at a new size (FR-SHELL-95: 200 ms after the last resize, -103). */
  | { type: "viewport" }
  /** Settle the applied layout again, once tokens are drawn (FR-SHELL-95 `load`). */
  | { type: "load"; drawn?: boolean }
  | { type: "reset" };

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
  { type: "push" | "return" | "viewport" | "reset" | "load" }
>;

export const isLayoutAction = (a: WindowAction): a is LayoutAction =>
  a.type === "push" ||
  a.type === "return" ||
  a.type === "viewport" ||
  a.type === "reset" ||
  a.type === "load";

const bound = (n: number, lo: number) => Math.max(lo, Math.min(GEOMETRY_LIMIT, Math.round(n)));

/** The rendered window in front: open and available, highest z. */
export function topWindow(ws: Windows, available: ReadonlySet<string>): WindowState | undefined {
  let top: WindowState | undefined;
  for (const w of ws) {
    if (w.state !== "open" || !available.has(w.kind)) continue;
    if (!top || w.z > top.z) top = w;
  }
  return top;
}

export interface Restored {
  windows: WindowState[];
  /** Set when the stored entry was invalid; the caller logs it (no error UI, FR-SHELL-17). */
  warning?: string;
  /** The windows come from the stored entry (else: the default layout). */
  stored?: true;
  /** The load settle changed the stored windows (FR-SHELL-53, -99): write the entry. */
  migrated?: true;
  /** FR-SHELL-155: entries taken over at this load (the caller runs each `onAbsorb` once). */
  absorbed?: readonly { kind: string; from: string }[];
  /** The `load` settle's displacement memory (a squeeze re-derived, FR-SHELL-159). */
  memory?: readonly Displacement[];
}

/**
 * FR-SHELL-155 (`absorbs`): a stored entry of an absorbed kind, open or minimised, while the
 * absorbing kind (same instance) is closed or has no entry, gives it its state and z; geometry:
 * the absorbing window's own rect if remembered; else, if the absorbed entry was remembered, its
 * x / y at the absorbing window's own size (`userSpot`, nudged on render, FR-SHELL-147); else the
 * `load` settle places it untouched. Absorbed entries are dropped either way.
 */
export function absorbEntries(
  registry: WindowRegistry,
  windows: readonly WindowState[],
  vp: Viewport,
): { windows: WindowState[]; absorbed: { kind: string; from: string }[]; dropped: boolean } {
  let out = [...windows];
  const absorbed: { kind: string; from: string }[] = [];
  let dropped = false;
  for (const def of registry.defs) {
    for (const from of def.absorbs ?? []) {
      for (const e of out.filter((w) => w.kind === from)) {
        out = out.filter((w) => w !== e);
        dropped = true;
        if (e.state === "closed") continue;
        const own = find(out, def.kind, e.instance);
        if (own && own.state !== "closed") continue;
        const size = own ?? fittedDefaultRect(def, vp);
        const rect = own && isRemembered(own) ? own : isRemembered(e) ? { x: e.x, y: e.y } : size;
        const next: WindowState = {
          ...(own ?? { kind: def.kind, instance: e.instance }),
          state: e.state,
          z: e.z,
          x: rect.x,
          y: rect.y,
          w: size.w,
          h: size.h,
          area: own && isRemembered(own) ? own.area : (e.area ?? own?.area ?? workArea(vp)),
          ...(!(own && isRemembered(own)) && isRemembered(e) && { userSpot: true as const }),
        };
        out = own ? out.map((w) => (w === own ? next : w)) : [...out, next];
        absorbed.push({ kind: def.kind, from });
      }
    }
  }
  return { windows: out, absorbed, dropped };
}

/**
 * Builds state from a stored entry (FR-SHELL-16/17/18). `raw` = the stored string, or null.
 * Missing → default; bad JSON or schema → default + warning. Unknown kinds are kept in memory
 * (skipped when rendering) and dropped at the next write by `serialise`. A type with
 * `restoreOpen: false` loads closed, its geometry kept (FR-SHELL-42). Old entries infer
 * `userSize` (FR-SHELL-100). Then the placer's `load` settle (FR-SHELL-95: zones, FR-SHELL-53's
 * default sizes), with `ctx` (default: every kind available, no token drawn).
 */
export function restoreLayout(
  registry: WindowRegistry,
  raw: string | null,
  vp: Viewport,
  avoid: readonly PlacementToken[] = [],
  regions: readonly KeepOut[] = keepOuts(registry.client, vp),
  ctx?: Partial<ManagerContext>,
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
  const taken = absorbEntries(registry, parsed.data.windows, vp);
  const windows = normaliseZ(
    taken.windows.map((w) => {
      const def = registry.get(w.kind);
      const next = inferUserSize(w, def);
      return next.state !== "closed" && def?.restoreOpen === false
        ? { ...next, state: "closed" as const }
        : next;
    }),
  );
  const loadCtx: ManagerContext = {
    registry,
    viewport: vp,
    available: new Set(registry.defs.map((d) => d.kind)),
    avoid: () => avoid,
    keepOuts: () => regions,
    ...ctx,
  };
  const p = settle(windows, { type: "load", drawn: avoid.length > 0 }, loadCtx);
  const migrated = p.windows !== windows || taken.dropped;
  return {
    windows: [...p.windows],
    stored: true,
    ...(migrated && { migrated: true }),
    ...(taken.absorbed.length > 0 && { absorbed: taken.absorbed }),
    ...(p.memory.length > 0 && { memory: p.memory }),
  };
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
    next.userSpot === cur.userSpot &&
    next.userSize === cur.userSize
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
 * The plan for one action (FR-SHELL-95): the next windows (the same array when nothing changed:
 * no write then) and what the placer did. Every change is one of the FR-SHELL-15 writes.
 */
export function plan(ws: Windows, action: WindowAction, ctx: ManagerContext): Plan {
  const memory = ctx.memory?.() ?? [];
  const none = (windows: Windows, mem = memory): Plan => ({
    windows,
    memory: mem,
    placed: new Map(),
    pcClear: new Map(),
    putAway: new Map(),
    log: [],
    yields: false,
  });
  const run = (windows: Windows, trigger: Trigger, c: ManagerContext = ctx) =>
    settle(windows, trigger, c);
  switch (action.type) {
    case "reset":
    case "push":
    case "return":
    case "viewport":
      return run(ws, action);
    case "load":
      return run(ws, { type: "load", drawn: action.drawn ?? true });
  }
  const instance = action.instance ?? MAIN_INSTANCE;
  const { kind } = action;
  const def = ctx.registry.get(kind);
  if (!def) return none(ws); // unknown kind: never opened or changed
  const id = windowId(kind, instance);
  /** The user's own change: this window's displacement memory goes (FR-SHELL-102). */
  const forget = (c: ManagerContext): ManagerContext => ({
    ...c,
    memory: () => memory.filter((d) => windowId(d.kind, d.instance) !== id),
  });

  switch (action.type) {
    case "open": {
      // FR-SHELL-08: last geometry, else the placer; front; minimised → restored. A feature open
      // never lands on another window (FR-SHELL-41); a user reopen keeps the stored rect unless
      // it is covered (FR-SHELL-56). Already open: front only.
      const cur = find(ws, kind, instance);
      if (cur) {
        if (cur.state === "open" || !ctx.available.has(kind)) {
          return none(toFront(ws, kind, instance, "open"));
        }
        const opened = patch(ws, kind, instance, (w) => ({ ...w, state: "open" }));
        const trigger: Trigger =
          action.by === "feature"
            ? { type: "open", kind, instance, by: "feature", fresh: false }
            : { type: "reopen", kind, instance };
        const p = run(opened, trigger, forget(ctx));
        return { ...p, windows: toFront(p.windows, kind, instance, "open") };
      }
      const added = {
        kind,
        instance,
        state: "open" as const,
        ...fittedDefaultRect(def, ctx.viewport),
        z: maxZ(ws) + 1,
        area: workArea(ctx.viewport),
      };
      const by = action.by ?? "user";
      const p = run([...ws, added], { type: "open", kind, instance, by, fresh: true });
      return { ...p, windows: normaliseZ([...p.windows]) };
    }
    case "close":
    case "minimise": {
      // A user close / minimise moves nothing (FR-SHELL-95); what this kind displaced may return
      // (its cause ended, FR-SHELL-102).
      const state = action.type === "close" ? "closed" : "minimised";
      const next = patch(ws, kind, instance, (w) => ({ ...w, state }));
      if (next === ws) return none(ws);
      const c = forget(ctx);
      const mine = `window:${kind}`;
      if (!(c.memory?.() ?? []).some((d) => d.cause === mine)) return none(next, c.memory?.());
      return run(next, { type: "return" }, c);
    }
    case "focus": {
      const cur = find(ws, kind, instance);
      if (cur?.state !== "open") return none(ws);
      return none(toFront(ws, kind, instance));
    }
    case "toggle": {
      // FR-SHELL-09: closed/minimised → open + front; behind → front; on top → minimise.
      const cur = find(ws, kind, instance);
      if (cur?.state !== "open") return plan(ws, { type: "open", kind, instance }, ctx);
      const top = topWindow(ws, ctx.available);
      if (top === cur) return plan(ws, { type: "minimise", kind, instance }, ctx);
      return none(toFront(ws, kind, instance));
    }
    case "appear": {
      // FR-SHELL-148: an appearance fronts the window (MRU), after the placer.
      const cur = find(ws, kind, instance);
      if (cur?.state !== "open" || !ctx.available.has(kind)) return none(ws);
      const p = run(ws, { type: "appear", kind, instance });
      return { ...p, windows: toFront(p.windows, kind, instance) };
    }
    case "settle": {
      const cur = find(ws, kind, instance);
      if (cur?.state !== "open" || !ctx.available.has(kind)) return none(ws);
      return run(ws, { type: "settle", kind, instance });
    }
    case "setRect": {
      const r = action.rect;
      // OQ-SHELL-55 B, FR-SHELL-100: a move / resize end makes the spot (and a resize the size)
      // the user's.
      const next = patch(ws, kind, instance, (w) => ({
        ...w,
        x: bound(r.x, -GEOMETRY_LIMIT),
        y: bound(r.y, -GEOMETRY_LIMIT),
        w: bound(Math.max(def.minSize.w, r.w), 1),
        h: bound(Math.max(def.minSize.h, r.h), 1),
        area: workArea(ctx.viewport),
        // FR-SHELL-39: after a user resize the stored height wins (cleared by reset).
        ...(action.resized && def.growToContent && { fixedH: true as const }),
        ...(action.resized && { userSize: true as const }),
        userSpot: true as const,
      }));
      return run(next, { type: "drag-end", kind, instance });
    }
  }
}

/**
 * Returns the next windows, or the same array when nothing changed (no write then).
 * Every change returned here is one of the FR-SHELL-15 writes.
 */
export function reduce(ws: Windows, action: WindowAction, ctx: ManagerContext): Windows {
  return plan(ws, action, ctx).windows;
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
