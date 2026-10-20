// Registry-driven layout checks (FR-SHELL-45, -47, -50, -56–58, -62): pure geometry the clients'
// layout tests run on their own registry at the reference viewports, and the brute-force oracle
// for auto placement. Nothing here runs in the app.
import { MAIN_INSTANCE, type WindowState } from "@shared/play-shell/layout";
import { renderedWindowRects } from "./free-area";
import { EDGE_GAP, type Rect, type Viewport } from "./geometry";
import { hardRects, keepOuts } from "./keep-outs";
import { defaultLayout, isCovered, type ManagerContext, reduce, type Windows } from "./manager";
import {
  fittedDefaultRect,
  type Placeable,
  type PlacementToken,
  pcBoxes,
  RAIL_CLEAR,
  usableArea,
} from "./placement";
import { defaultSizeAt, type WindowDef, type WindowRegistry } from "./registry";

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
  /** What it was placed against: the other shown windows' rendered rects, the hard regions. */
  others: Rect[];
  hard: Rect[];
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
    const others = rects.filter((_, i) => open[i] !== me);
    steps.push({ kind, rect: mine ?? null, parked, hits, others, hard: hardRects(regions) });
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

// ---- sprint 6: the brute check and the layout sequences (FR-SHELL-62) ----

/** What auto placement saw: the other open windows' rendered rects, hard regions, footprints. */
export interface PlaceScene {
  windows: readonly Rect[];
  hard: readonly Rect[];
  tokens: readonly PlacementToken[];
}

const grow = (r: Rect, m: number): Rect => ({
  x: r.x - m,
  y: r.y - m,
  w: r.w + 2 * m,
  h: r.h + 2 * m,
});

/** The window's heights and widths auto placement works with (placement.ts). */
function sizesOf(def: Placeable, vp: Viewport, hard: readonly Rect[]) {
  const base = fittedDefaultRect(def, vp, hard);
  const a = usableArea(vp);
  const fullH = Math.min(base.h, a.bottom - a.top);
  const minH = Math.min(def.minSize.h, fullH);
  const openH = def.minOpenH === undefined ? null : Math.max(minH, Math.min(def.minOpenH, fullH));
  const minX = Math.max(a.left, Math.min(base.x, RAIL_CLEAR));
  return { base, a, fullH, minH, openH, minX, w: base.w, minW: Math.min(def.minSize.w, base.w) };
}

/**
 * The fields of FR-SHELL-45's rank the brute check compares, for `r`, in placement's order: [not
 * clear (12 px gap to windows and hard regions), over a PC footprint + 4 px, an edge through one
 * (#292: holding the PCs it covers whole beats cutting one; still rank (2), before (2b)), not
 * clear at `minOpenH`, over a token]. `margin`: footprints grown by that much more (the oracle's
 * spots keep the 12 px candidates keep: rows and columns sit 12 px off a footprint, FR-SHELL-58).
 */
export function placeFields(
  r: Rect,
  def: Placeable,
  vp: Viewport,
  scene: PlaceScene,
  margin = 0,
): number[] {
  return fieldsOf(def, vp, scene, margin)(r);
}

/** `placeFields` for one window and scene, its lists grown once (the oracle calls it a lot). */
function fieldsOf(def: Placeable, vp: Viewport, scene: PlaceScene, margin: number) {
  const { openH } = sizesOf(def, vp, scene.hard);
  const blocks = [...scene.windows, ...scene.hard].map((o) => grow(o, EDGE_GAP));
  const pcs = pcBoxes(scene.tokens).map((p) => grow(p, margin));
  const tokens = scene.tokens.map((t) => grow(t, margin));
  return (r: Rect): number[] => {
    const clear = !blocks.some((o) => overlaps(r, o));
    const over = pcs.filter((p) => overlaps(r, p));
    const inside = (p: Rect) =>
      p.x >= r.x && p.y >= r.y && p.x + p.w <= r.x + r.w && p.y + p.h <= r.y + r.h;
    return [
      clear ? 0 : 1,
      over.length > 0 ? 1 : 0,
      over.every(inside) ? 0 : 1,
      openH === null || (clear && r.h >= openH) ? 0 : 1,
      tokens.some((t) => overlaps(r, t)) ? 1 : 0,
    ];
  };
}

const less = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number);
  return false;
};

/**
 * The brute check's oracle (FR-SHELL-62 (c), rulings-b #19): the best `placeFields` any rect of
 * the window's full width (full, `minOpenH` and min height) reaches on a 16-px grid of the usable
 * area, with a 4-px refine around the winners; then, when none is clear and over no PC and no
 * token, the same at min width, counted only where it is all three, or anywhere when no
 * full-width spot is clear (placement narrows a window to get off every token, or to stay clear
 * of windows before it parks one). Footprints count with the 12-px candidate gap.
 */
export function bruteBest(def: Placeable, vp: Viewport, scene: PlaceScene): number[] {
  const z = sizesOf(def, vp, scene.hard);
  const heights = [...new Set([z.fullH, z.minH, ...(z.openH === null ? [] : [z.openH])])];
  const fields = fieldsOf(def, vp, scene, EDGE_GAP);
  const free = (f: readonly number[]) => f[0] === 0 && f[1] === 0 && f[4] === 0;
  let best = [1, 1, 1, 1, 1];
  const search = (cw: number, onlyFree: boolean) => {
    for (const h of heights) {
      const xMax = z.a.right - cw;
      const yMax = z.a.bottom - h;
      if (xMax < z.minX || yMax < z.a.top) continue;
      const steps = (lo: number, hi: number) => {
        const out: number[] = [];
        for (let v = lo; v < hi; v += 16) out.push(v);
        out.push(hi);
        return out;
      };
      const winners: Rect[] = [];
      const take = (r: Rect) => {
        const f = fields(r);
        if (onlyFree && !free(f)) return;
        if (less(f, best)) {
          best = f;
          winners.length = 0;
        }
        if (!less(best, f) && winners.length < 16) winners.push(r);
      };
      for (const x of steps(z.minX, xMax))
        for (const y of steps(z.a.top, yMax)) take({ x, y, w: cw, h });
      for (const r of [...winners]) {
        for (let dx = -12; dx <= 12; dx += 4) {
          for (let dy = -12; dy <= 12; dy += 4) {
            const x = Math.max(z.minX, Math.min(xMax, r.x + dx));
            const y = Math.max(z.a.top, Math.min(yMax, r.y + dy));
            take({ x, y, w: cw, h });
          }
        }
      }
    }
  };
  search(z.w, false);
  // Min width: where clear and over no PC and no token, or where clear at all when no full-width
  // spot is (placement narrows to stay clear before it parks a window, FR-SHELL-47).
  if (z.minW < z.w && !free(best)) search(z.minW, best[0] === 0);
  return best;
}

/** One step of a layout sequence (FR-SHELL-62 (b)). */
export interface LayoutStep {
  /** The pass: `open`, `reopen`, `reopen <w>×<h>`, `protected`. */
  step: string;
  vp: Viewport;
  kind: string;
  /** Rendered rect after the step; null when not open. */
  rect: Rect | null;
  /**
   * How the open came out (`data-placed`): first open `auto` / `default`; a reopen `stored` (not
   * covered, or protected) / `reopened` (covered, auto-placed).
   */
  placed: "auto" | "default" | "stored" | "reopened";
  /** Windows the open auto-minimised (FR-SHELL-47). */
  parked: string[];
  /** Invariants it broke (FR-SHELL-62 (c)); empty = fine. */
  problems: string[];
}

export interface LayoutRunOptions {
  /** Viewports from the first to the last, each smaller (the `viewport` action between). */
  viewports: readonly Viewport[];
  /** Kinds opened, closed and reopened, in this order. */
  kinds: readonly string[];
  available: ReadonlySet<string>;
  /** The client's token footprints at a viewport, the camera fitted for these windows. */
  tokensAt: (vp: Viewport, windows: readonly Rect[]) => PlacementToken[];
  /** The protected (default-open) kind closed and reopened at the end (FR-SHELL-56 (5)). */
  protectedKind: string;
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * FR-SHELL-62 (b): the default layout (token-free, as on first load) at the first viewport; open
 * `kinds` in order, close them all, open them again; then at each next viewport close them,
 * switch, reopen them; then close the protected kind, open the first kind and move it onto the
 * protected one's spot, reopen the protected one. Every open is a user open; each is checked
 * (FR-SHELL-62 (c)).
 */
export function layoutRun(registry: WindowRegistry, o: LayoutRunOptions): LayoutStep[] {
  const steps: LayoutStep[] = [];
  let vp = o.viewports[0] as Viewport;
  const regionsAt = (v: Viewport) => keepOuts(registry.client, v, new Map());
  const shown = (ws: Windows) => ws.filter((w) => w.state === "open" && o.available.has(w.kind));
  const rendered = (ws: Windows, v: Viewport) =>
    renderedWindowRects(shown(ws), registry, o.available, v, new Map(), hardRects(regionsAt(v)));
  let ws: Windows = defaultLayout(registry, vp, [], regionsAt(vp));
  let tokens = o.tokensAt(vp, rendered(ws, vp));
  const ctx = (): ManagerContext => ({
    registry,
    viewport: vp,
    available: o.available,
    avoid: () => tokens,
    keepOuts: () => regionsAt(vp),
  });
  const find = (list: Windows, kind: string) =>
    list.find((w) => w.kind === kind && w.instance === MAIN_INSTANCE);
  const rectNow = (list: Windows, kind: string): Rect | null => {
    const open = shown(list);
    const i = open.findIndex((w) => w.kind === kind);
    return i < 0 ? null : (rendered(list, vp)[i] as Rect);
  };

  const open = (step: string, kind: string) => {
    const def = registry.get(kind);
    if (!def) return;
    const before = ws;
    const cur = find(before, kind);
    const reopen = cur !== undefined && cur.state !== "open";
    const was = cur && reopen ? rectOf(cur) : null;
    const covered = cur && reopen ? isCovered(before, cur, ctx()) : false;
    ws = reduce(ws, { type: "open", kind }, ctx());
    const after = find(ws, kind) as WindowState;
    const moved = !sameRect(was, rectOf(after));
    const parked = ws
      .filter((w) => w.state === "minimised" && find(before, w.kind)?.state === "open")
      .map((w) => w.kind);
    const rect = rectNow(ws, kind);
    const placed = reopen
      ? covered && !def.defaultOpen && !def.fixedDefault
        ? "reopened"
        : "stored"
      : sameRect(rectOf(after), fittedDefaultRect(def, vp, hardRects(regionsAt(vp))))
        ? "default"
        : "auto";
    const problems: string[] = [];
    if (!def.fixedDefault && rect) {
      // Not covered → the stored rect (FR-SHELL-56 (3)); covered → auto placement, which may
      // land on the same rect once the windows over it are parked (checked below).
      if (reopen && !covered && moved) problems.push("reopen: not covered, moved");
      if (placed === "auto" || placed === "reopened") {
        const others = shown(ws).filter((w) => w.kind !== kind);
        const rects = rendered(ws, vp).filter((_, i) => shown(ws)[i]?.kind !== kind);
        const hard = hardRects(regionsAt(vp));
        const on = [...rects, ...hard].some((r) => overlaps(rect, r));
        const parkable = others.some((w) => {
          const d = registry.get(w.kind);
          return d !== undefined && !d.defaultOpen && !d.fixedDefault;
        });
        if (on && parkable) problems.push("on a window while a launcher window could be parked");
        const scene = { windows: rects, hard, tokens };
        const got = placeFields(rect, def, vp, scene);
        const best = bruteBest(def, vp, scene);
        if (best[0] === 0 && less(best, got))
          problems.push(`brute check: got ${got.join("")}, a spot gives ${best.join("")}`);
      }
    }
    steps.push({ step, vp, kind, rect, placed, parked, problems });
  };
  const closeAll = () => {
    for (const kind of o.kinds) ws = reduce(ws, { type: "close", kind }, ctx());
  };

  for (const kind of o.kinds) open("open", kind);
  closeAll();
  for (const kind of o.kinds) open("reopen", kind);
  for (const next of o.viewports.slice(1)) {
    closeAll();
    vp = next;
    ws = reduce(ws, { type: "viewport" }, ctx());
    tokens = o.tokensAt(vp, rendered(defaultLayout(registry, vp, [], regionsAt(vp)), vp));
    for (const kind of o.kinds) open(`reopen ${vp.w}×${vp.h}`, kind);
  }
  // FR-SHELL-56 (5): a launcher window moved onto the closed protected window's spot (test-mode
  // `fixedDefault` windows keep theirs, (5)).
  const first = o.kinds.find((k) => !registry.get(k)?.fixedDefault);
  const prot = rectNow(ws, o.protectedKind);
  if (first && prot) {
    closeAll();
    ws = reduce(ws, { type: "close", kind: o.protectedKind }, ctx());
    open("protected", first);
    ws = reduce(ws, { type: "setRect", kind: first, rect: prot }, ctx());
    open("protected", o.protectedKind);
    const step = steps.at(-1) as LayoutStep;
    if (!sameRect(step.rect, prot)) step.problems.push("protected window moved");
    const over = rectNow(ws, first);
    if (over && step.rect && overlaps(over, step.rect)) {
      step.problems.push(`${first} still over it`);
    }
  }
  return steps;
}

/**
 * FR-SHELL-61 (1): what a new window type registers. Kinds allowed a taller min size (seams S3:
 * Preferences, it still fits the 412-px band above the Game log at 1280×720).
 */
export const CONTRACT_MIN_EXCEPTIONS: Readonly<Record<string, { w: number; h: number }>> = {
  "shell.prefs": { w: 320, h: 280 },
};

/** FR-SHELL-61 (1): a new window type's breaches of the contract (empty = fine). */
export function contractProblems(def: WindowDef): string[] {
  const out: string[] = [];
  if (def.defaultOpen) out.push("defaultOpen");
  const min = CONTRACT_MIN_EXCEPTIONS[def.kind] ?? { w: 320, h: 240 };
  if (def.minSize.w > min.w || def.minSize.h > min.h)
    out.push(`min ${def.minSize.w}×${def.minSize.h}`);
  for (const vp of REFERENCE_VIEWPORTS) {
    const s = defaultSizeAt(def, vp);
    if (s.w > 440) out.push(`width ${s.w} at ${vp.w}×${vp.h}`);
    if (s.h > 412 && (def.minOpenH ?? s.h) > 412) out.push(`height ${s.h} at ${vp.w}×${vp.h}`);
  }
  return out;
}
