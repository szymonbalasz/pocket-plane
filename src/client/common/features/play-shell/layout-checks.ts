// Registry-driven layout checks (FR-SHELL-45, -47, -50): pure geometry the clients' layout tests
// run on their own registry at the reference viewports. Nothing here runs in the app.
import { MAIN_INSTANCE, type WindowState } from "@shared/play-shell/layout";
import { renderedWindowRects } from "./free-area";
import type { Rect, Viewport } from "./geometry";
import { hardRects, keepOuts } from "./keep-outs";
import { defaultLayout, type ManagerContext, reduce, type Windows } from "./manager";
import type { WindowRegistry } from "./registry";

/** The reference viewports of the named default layouts (FR-SHELL-50). */
export const REFERENCE_VIEWPORTS: readonly Viewport[] = [
  { w: 1280, h: 720 },
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
  { w: 1600, h: 900 },
];

export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const rectOf = (w: Rect): Rect => ({ x: w.x, y: w.y, w: w.w, h: w.h });

export interface LaunchStep {
  kind: string;
  /** Its rect after the open (null: not open). */
  rect: Rect | null;
  /** Windows the open auto-minimised (FR-SHELL-47). */
  parked: string[];
  /** What the open landed on: other open windows' kinds, `keep-out:<id>` for hard regions. */
  hits: string[];
}

/**
 * Opens `kinds` one by one from the launcher (user opens, no stored geometry) on `start` (the
 * default layout unless given) and reports each step.
 */
export function launcherSequence(
  registry: WindowRegistry,
  viewport: Viewport,
  kinds: readonly string[],
  opts: Partial<Pick<ManagerContext, "available" | "avoid" | "keepOuts">> & {
    start?: Windows;
  } = {},
): { windows: Windows; steps: LaunchStep[] } {
  const available = opts.available ?? new Set(registry.defs.map((d) => d.kind));
  const ctx: ManagerContext = { registry, viewport, available, ...opts };
  const regions = opts.keepOuts?.() ?? keepOuts(registry.client, viewport);
  let ws: Windows = opts.start ?? defaultLayout(registry, viewport, opts.avoid?.() ?? [], regions);
  const steps: LaunchStep[] = [];
  for (const kind of kinds) {
    const before = ws;
    ws = reduce(ws, { type: "open", kind }, ctx);
    const parked = ws
      .filter((w) => w.state === "minimised")
      .filter(
        (w) => before.find((b) => b.kind === w.kind && b.instance === w.instance)?.state === "open",
      )
      .map((w) => w.kind);
    const me = ws.find((w) => w.kind === kind && w.instance === MAIN_INSTANCE);
    const shown = (list: Windows) =>
      list.filter((w) => w.state === "open" && available.has(w.kind));
    const rects = renderedWindowRects(
      shown(ws),
      registry,
      available,
      viewport,
      new Map(),
      hardRects(regions),
    );
    const open = shown(ws);
    const mine = me && me.state === "open" ? rects[open.indexOf(me)] : undefined;
    const hits: string[] = [];
    if (mine) {
      open.forEach((w, i) => {
        if (w !== me && overlaps(mine, rects[i] as Rect)) hits.push(w.kind);
      });
      for (const k of regions)
        if (k.kind === "hard" && overlaps(mine, k.rect)) hits.push(`keep-out:${k.id}`);
    }
    steps.push({ kind, rect: mine ?? null, parked, hits });
  }
  return { windows: ws, steps };
}

/** Kinds opened from the launcher in the registry-driven test: product, not default-open. */
export function launcherKinds(registry: WindowRegistry, product: ReadonlySet<string>): string[] {
  return registry.defs
    .filter((d) => product.has(d.kind) && !d.defaultOpen && d.launcher)
    .map((d) => d.kind);
}

/** One window's rect in a layout, by kind. */
export function rectIn(ws: readonly WindowState[], kind: string): Rect {
  const w = ws.find((x) => x.kind === kind);
  if (!w) throw new Error(`${kind} not in the layout`);
  return rectOf(w);
}
