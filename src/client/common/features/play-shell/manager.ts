// Window manager reducer (FR-SHELL-08–12, 14, 16–18). Pure: no DOM, no storage.
// Holds every window's *stored* state; rendering clamps (geometry.ts) without writing back.
import { GEOMETRY_LIMIT, Layout, MAIN_INSTANCE, type WindowState } from "@shared/play-shell/layout";
import { clampRect, type Rect, type Viewport } from "./geometry";
import { fittedDefaultRect, placeRect } from "./placement";
import type { WindowRegistry } from "./registry";

export type Windows = readonly WindowState[];

export type WindowAction =
  | { type: "open"; kind: string; instance?: string }
  | { type: "close"; kind: string; instance?: string }
  | { type: "minimise"; kind: string; instance?: string }
  | { type: "focus"; kind: string; instance?: string }
  | { type: "toggle"; kind: string; instance?: string }
  | { type: "setRect"; kind: string; instance?: string; rect: Rect }
  /**
   * The kind just became available (e.g. player `cbt.initiative` on Start). If it is open, still
   * at its default-layout geometry (never moved) and would cover a window on screen, it goes to
   * the next free slot instead. A window the user placed keeps its spot (FR-SHELL-18).
   */
  | { type: "appear"; kind: string; instance?: string }
  | { type: "reset" };

export interface ManagerContext {
  registry: WindowRegistry;
  viewport: Viewport;
  /** Kinds rendered right now (registered + available). */
  available: ReadonlySet<string>;
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
 * This client's default layout: every `defaultOpen` type at its default geometry, fitted to
 * the viewport; one that would overlap an earlier one goes to the next free slot (FR-SHELL-14).
 */
export function defaultLayout(registry: WindowRegistry, vp: Viewport): WindowState[] {
  const out: WindowState[] = [];
  for (const d of registry.defs) {
    if (!d.defaultOpen) continue;
    out.push({
      kind: d.kind,
      instance: MAIN_INSTANCE,
      state: "open",
      ...placeRect(d, vp, out),
      z: out.length + 1,
    });
  }
  return out;
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Rendered rects of the windows on screen now, except (kind, instance). */
function onScreen(ws: Windows, ctx: ManagerContext, kind: string, instance: string): Rect[] {
  return ws
    .filter(
      (w) =>
        w.state === "open" &&
        ctx.available.has(w.kind) &&
        !(w.kind === kind && w.instance === instance),
    )
    .map((w) => clampRect(w, ctx.viewport));
}

export interface Restored {
  windows: WindowState[];
  /** Set when the stored entry was invalid; the caller logs it (no error UI, FR-SHELL-17). */
  warning?: string;
}

/**
 * Builds state from a stored entry (FR-SHELL-16/17/18). `raw` = the stored string, or null.
 * Missing → default; bad JSON or schema → default + warning. Unknown kinds are kept in memory
 * (skipped when rendering) and dropped at the next write by `serialise`.
 */
export function restoreLayout(
  registry: WindowRegistry,
  raw: string | null,
  vp: Viewport,
): Restored {
  if (raw === null) return { windows: defaultLayout(registry, vp) };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { windows: defaultLayout(registry, vp), warning: "layout entry is not JSON" };
  }
  const parsed = Layout.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      windows: defaultLayout(registry, vp),
      warning: `layout entry invalid (${first?.path.join(".")}: ${first?.message})`,
    };
  }
  return { windows: normaliseZ(parsed.data.windows) };
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
    next.z === cur.z
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
  if (action.type === "reset") return defaultLayout(ctx.registry, ctx.viewport);
  const instance = action.instance ?? MAIN_INSTANCE;
  const { kind } = action;
  const def = ctx.registry.get(kind);
  if (!def) return ws; // unknown kind: never opened or changed

  switch (action.type) {
    case "open": {
      // FR-SHELL-08: last geometry, else default (first free slot, not over an open window);
      // front; minimised → restored.
      if (find(ws, kind, instance)) return toFront(ws, kind, instance, "open");
      const rect = placeRect(def, ctx.viewport, onScreen(ws, ctx, kind, instance));
      return normaliseZ([...ws, { kind, instance, state: "open", ...rect, z: maxZ(ws) + 1 }]);
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
      const others = onScreen(ws, ctx, kind, instance);
      const shown = clampRect(cur, ctx.viewport);
      if (!others.some((o) => overlaps(shown, o))) return ws;
      const same = (r: Rect | undefined) =>
        r !== undefined && r.x === cur.x && r.y === cur.y && r.w === cur.w && r.h === cur.h;
      const asDefault = defaultLayout(ctx.registry, ctx.viewport).find((w) => w.kind === kind);
      if (!same(asDefault) && !same(fittedDefaultRect(def, ctx.viewport))) return ws;
      const rect = placeRect(def, ctx.viewport, others);
      return patch(ws, kind, instance, (w) => ({ ...w, ...rect }));
    }
    case "setRect": {
      const r = action.rect;
      return patch(ws, kind, instance, (w) => ({
        ...w,
        x: bound(r.x, -GEOMETRY_LIMIT),
        y: bound(r.y, -GEOMETRY_LIMIT),
        w: bound(Math.max(def.minSize.w, r.w), 1),
        h: bound(Math.max(def.minSize.h, r.h), 1),
      }));
    }
  }
}

export type LauncherState = "open" | "minimised" | "closed";

export function launcherState(ws: Windows, kind: string, instance = MAIN_INSTANCE): LauncherState {
  return find(ws, kind, instance)?.state ?? "closed";
}
