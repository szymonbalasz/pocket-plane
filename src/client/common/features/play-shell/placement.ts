// Auto placement: where a window goes when the user didn't choose (FR-SHELL-08, -40, -45–47,
// -51, -57, -58). Pure, deterministic.
// Candidates: the fitted default rect; every spot in the default column and the left / right
// edge column at the rows given by the usable area's, every open window's and keep-out region's
// and every token footprint's edges (± 12), each at full size, at `minOpenH`, shrunk to the
// height free there, and at min height (fallback). When no edge candidate is clear, keeps
// `minOpenH`, covers no PC and no token, columns beside every open window, keep-out region and
// token footprint are added (inward columns, FR-SHELL-46, -58). Token rows and columns come from
// ≤ 200 footprints, ≤ 4,000 spots; past that the ones farthest from the default rect go first.
// Tokens are footprints (FR-SHELL-57: grid cells on screen, not the drawn node's box).
// Rank, lexicographic (FR-SHELL-45):
//   (1) clear of every open window and hard keep-out region (else, screen full: no protected
//       window, no title bar, least protected area, least overlap; FR-SHELL-47's fallback);
//   (2) covers no PC footprint grown by 4 px (FR-SHELL-57), else holds the ones it covers whole
//   (no edge through one); (1b) `minOpenH` windows: clear at
//   ≥ `minOpenH` (after (2): a slightly shorter window beats one over a PC, walkthrough W1);
//   (2c) covers no token footprint (FR-SHELL-58: a spot over no token beats size, edge and the
//   soft box);
//   (3) edge column before inward; (4) clear of soft keep-out regions; (5) least token area;
//   (6) full size (≥ `minOpenH` counts as full; else, `minOpenH` windows: the tallest, FR-NOTE-31);
//   (7) default column; (8)–(9) nearest to the previous rect (`prev`: a displaced window's, the
//   pre-push one); (10) nearest to the fitted default rect, then taller, higher, more left, least
//   over soft regions (FR-SHELL-111). `gap`: 12 px, or 4 px on a rung's retry (FR-SHELL-98).
// A window that renders taller than its min size (`need`: a `growToContent` window's measured
// content height, FR-SHELL-39) never gets a slot shorter than that. Sprint 7 (FR-SHELL-77, -79):
// `floor` keeps every candidate at least the useful size (step (a)); `leastPc` ranks (2) by the
// least PC footprint area instead of holding PCs whole (step (e), the last resort).
import {
  defaultRect,
  EDGE_GAP,
  LAUNCHER_CLEAR,
  RAIL_CLEAR,
  type Rect,
  TITLE_H,
  TOP_BAR_H,
  type Viewport,
} from "./geometry";
import { defaultSizeAt, type Size, type WindowDef } from "./registry";

export { RAIL_CLEAR };

/** A PC's footprint grows by this much per side for the PC rule (FR-SHELL-57, OQ-SHELL-42 A). */
export const PC_MARGIN = 4;
/** Token footprints that give candidate rows and columns (FR-SHELL-58), nearest first. */
export const TOKEN_EDGES_MAX = 200;
/** Candidate spots (columns × rows) per auto placement (FR-SHELL-58's cap). */
export const SPOTS_MAX = 4000;

export type Placeable = Pick<
  WindowDef,
  "defaultPosition" | "defaultSize" | "minSize" | "fixedDefault" | "minOpenH" | "usefulSize"
>;

interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where default-placed windows may go: below the top bar, above the launcher, edge gaps. */
export function usableArea(vp: Viewport): Area {
  return {
    left: EDGE_GAP,
    top: TOP_BAR_H + EDGE_GAP,
    right: vp.w - EDGE_GAP,
    bottom: vp.h - EDGE_GAP - LAUNCHER_CLEAR,
  };
}

/** Moves (pos, len) into [lo, hi]; shrinks len first, never below min. */
function fitAxis(pos: number, len: number, min: number, lo: number, hi: number): [number, number] {
  let p = Math.max(lo, pos);
  const l = Math.max(min, Math.min(len, hi - p));
  if (p + l > hi) p = Math.max(lo, hi - l);
  return [p, l];
}

/** Any overlap (≥ 1 px² of area). */
const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Some rect of `list` overlaps `r` (a loop: placement ranks thousands of candidates). */
function anyHit(r: Rect, list: readonly Rect[]): boolean {
  for (const o of list) if (hits(r, o)) return true;
  return false;
}

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * The default rect at the type's default size for this viewport (FR-SHELL-51), fitted to the
 * usable area: e.g. a tall window ends above the launcher. A top-anchored rect that would overlap
 * a `hard` keep-out region below its top (the players' toast corner) ends 12 px above it, never
 * below min size; any other overlapping rect is left as is (placement puts it elsewhere).
 */
export function fittedDefaultRect(
  def: Placeable,
  vp: Viewport,
  hard: readonly Rect[] = [],
  size: Size = defaultSizeAt(def, vp),
): Rect {
  const r = defaultRect(def.defaultPosition, size, vp);
  const a = usableArea(vp);
  const [x, w] = fitAxis(r.x, r.w, def.minSize.w, a.left, a.right);
  const [y, h] = fitAxis(r.y, r.h, def.minSize.h, a.top, a.bottom);
  let out = { x, y, w, h };
  if (def.defaultPosition.anchor.startsWith("top")) {
    for (const k of hard) {
      if (k.y <= y || overlapArea(out, k) === 0) continue;
      const cut = k.y - EDGE_GAP - y;
      if (cut >= def.minSize.h && cut < out.h) out = { ...out, h: cut };
    }
  }
  return out;
}

/** An open window placement must avoid; `protected`: a default-open type (FR-SHELL-45). */
export interface Obstacle extends Rect {
  protected?: boolean;
}

/**
 * A drawn token's on-screen footprint (FR-SHELL-57); `pc`: it has an owner (a PC, FR-SHELL-45
 * (2)).
 */
export interface PlacementToken extends Rect {
  pc?: boolean;
}

/** PC footprints grown by `PC_MARGIN`: what no auto-placed window covers while it can. */
export function pcBoxes(tokens: readonly PlacementToken[]): Rect[] {
  const m = PC_MARGIN;
  return tokens
    .filter((t) => t.pc)
    .map((t) => ({ x: t.x - m, y: t.y - m, w: t.w + 2 * m, h: t.h + 2 * m }));
}

/** No PC footprint (+ 4 px) under `r` (`ui-window` `data-pc-clear`, FR-SHELL-57). */
export const pcClear = (r: Rect, tokens: readonly PlacementToken[]) =>
  !pcBoxes(tokens).some((p) => overlapArea(r, p) > 0);

export interface PlaceInput {
  /** Rendered rects of the windows open now (minus the one placed). */
  windows?: readonly Obstacle[];
  /** Hard keep-out regions: blocked like windows (FR-SHELL-48). */
  hard?: readonly Rect[];
  /** Soft keep-out regions: avoided when possible (FR-SHELL-45 (4)). */
  soft?: readonly Rect[];
  /** On-screen token boxes (this client's, current camera). */
  tokens?: readonly PlacementToken[];
  /** Height the window renders at (measured content), if known. */
  need?: number;
  /**
   * Nothing is left to auto-minimise (FR-SHELL-47): also try the window at min size (FR-SHELL-45's
   * last resort), in every column.
   */
  lastResort?: boolean;
  /**
   * The smallest size a candidate may take (FR-SHELL-79: the useful size, FR-SHELL-77 (a)); absent
   * = the min size (every shrink allowed, step (d)).
   */
  floor?: Size;
  /** FR-SHELL-77 (e): over PCs, the least PC footprint area wins (not the PCs held whole). */
  leastPc?: boolean;
  /**
   * The window's full size (FR-SHELL-100's target: a user size, else the fitted default); absent
   * = the default size. Placed at the type's default anchor.
   */
  size?: Size;
  /** Gap kept to windows, regions and footprints (FR-SHELL-98: 12 px, a retry at 4 px). */
  gap?: number;
  /**
   * The window's previous rect (FR-SHELL-111 (8)–(9): nearest the pre-push / previous rect ranks
   * before nearest the fitted default).
   */
  prev?: Rect;
  /** One settle's token grids (FR-SHELL-158), for searches on these same `tokens`. */
  memo?: PlaceMemo;
}

/**
 * FR-SHELL-158 (BL-82): the token-derived half of the candidate grid, built once per (window
 * position, size, gap, heights) and reused: the footprints nearest the default rect, their rows,
 * their full-width columns and the spot cap's drop order (`capSpots`: farthest first).
 */
interface TokenGrid {
  edgeTokens: Rect[];
  rows: number[];
  cols: number[];
  drop: { v: number; d: number; x: boolean }[];
}

/**
 * FR-SHELL-158 (BL-82): one settle's token grids and PC boxes, shared by every search on the same
 * `tokens` (the 12-px / 4-px retries, the look-ahead, the yield). Results are the same as without.
 */
export interface PlaceMemo {
  tokens: readonly PlacementToken[];
  plain?: Rect[];
  pcs?: Rect[];
  grids: Map<string, TokenGrid>;
}

export const placeMemo = (tokens: readonly PlacementToken[]): PlaceMemo => ({
  tokens,
  grids: new Map(),
});

/** FR-SHELL-158's profile (printed by `placement.bench.ts`): searches run, token grids built. */
export const placeStats = { searches: 0, grids: 0 };

export interface Placement {
  rect: Rect;
  /** Clear of every open window and hard keep-out region; false = screen full (FR-SHELL-47). */
  clear: boolean;
  /** Covers no PC footprint + 4 px (FR-SHELL-57, rank (2)). */
  pcClear: boolean;
  /** An inward column (beside a window, region or token), not the edge one (rank (3), #162). */
  inward?: true;
}

/**
 * Keeps the token-derived (`token`) values of `cols` / `rows` nearest to (bx, by) until
 * columns × rows ≤ `SPOTS_MAX` (FR-SHELL-58's cap); the others are always kept.
 */
export function capSpots(
  cols: readonly { v: number; token: boolean }[],
  rows: readonly { v: number; token: boolean }[],
  bx: number,
  by: number,
): { cols: number[]; rows: number[] } {
  const keep = (list: readonly { v: number; token: boolean }[]) => new Set(list.map((e) => e.v));
  const xs = keep(cols);
  const ys = keep(rows);
  if (xs.size * ys.size > SPOTS_MAX) {
    const fixedX = new Set(cols.filter((e) => !e.token).map((e) => e.v));
    const fixedY = new Set(rows.filter((e) => !e.token).map((e) => e.v));
    const drop = [
      ...[...xs].filter((v) => !fixedX.has(v)).map((v) => ({ v, d: Math.abs(v - bx), x: true })),
      ...[...ys].filter((v) => !fixedY.has(v)).map((v) => ({ v, d: Math.abs(v - by), x: false })),
    ].sort((a, b) => b.d - a.d || a.v - b.v || Number(a.x) - Number(b.x));
    for (const e of drop) {
      if (xs.size * ys.size <= SPOTS_MAX) break;
      (e.x ? xs : ys).delete(e.v);
    }
  }
  return { cols: [...xs], rows: [...ys] };
}

/**
 * `capSpots` with the token values' drop order given (`drop`: unique token values, farthest from
 * the default rect first): the same spots, without sorting them again on every search.
 */
function capGrid(
  fixedCols: readonly number[],
  tokenCols: readonly number[],
  fixedRows: readonly number[],
  tokenRows: readonly number[],
  drop: readonly { v: number; x: boolean }[],
): { cols: number[]; rows: number[] } {
  const xs = new Set([...fixedCols, ...tokenCols]);
  const ys = new Set([...fixedRows, ...tokenRows]);
  if (xs.size * ys.size > SPOTS_MAX) {
    const fixedX = new Set(fixedCols);
    const fixedY = new Set(fixedRows);
    for (const e of drop) {
      if (xs.size * ys.size <= SPOTS_MAX) break;
      if ((e.x ? fixedX : fixedY).has(e.v)) continue;
      (e.x ? xs : ys).delete(e.v);
    }
  }
  return { cols: [...xs], rows: [...ys] };
}

/**
 * FR-SHELL-158 (BL-82): whether `placeWindow(def, vp, input)` can find a **clear** spot at all
 * (rank (1)): some rect of its smallest candidate size (the min / `floor` size, `need`), inside
 * its candidate bounds, 12 (`gap`) px clear of every window and hard region. Exact: every
 * candidate is at least that size, so none is clear when this is false; a clear placement slides
 * left and up until it touches a blocker or the bounds, so testing those corners suffices. The
 * ladder skips searches that can't be accepted.
 */
export function roomFor(def: Placeable, vp: Viewport, input: PlaceInput = {}): boolean {
  if (def.fixedDefault) return true;
  const plain = (r: Rect): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h });
  const hard = (input.hard ?? []).map(plain);
  const base = fittedDefaultRect(def, vp, hard, input.size);
  const a = usableArea(vp);
  const g = input.gap ?? EDGE_GAP;
  const need = Math.ceil(input.need ?? 0);
  const fullH = Math.min(Math.max(base.h, need), a.bottom - a.top);
  const h = Math.min(Math.max(def.minSize.h, input.floor?.h ?? 0, need), fullH);
  const w = Math.min(Math.max(def.minSize.w, input.floor?.w ?? 0), base.w);
  const minX = Math.max(a.left, RAIL_CLEAR);
  const blocks = [...(input.windows ?? []).map(plain), ...hard].map((o) => ({
    x: o.x - g,
    y: o.y - g,
    w: o.w + 2 * g,
    h: o.h + 2 * g,
  }));
  const xs = new Set(
    [minX, ...blocks.map((b) => b.x + b.w)].map((x) => Math.max(minX, Math.min(x, a.right - w))),
  );
  const ys = new Set(
    [a.top, ...blocks.map((b) => b.y + b.h)].map((y) => Math.min(Math.max(a.top, y), a.bottom - h)),
  );
  for (const x of xs) for (const y of ys) if (!anyHit({ x, y, w, h }, blocks)) return true;
  return false;
}

/** Where a window opens by itself (auto placement; rank in the header). */
export function placeWindow(def: Placeable, vp: Viewport, input: PlaceInput = {}): Placement {
  // Plain {x, y, w, h} copies: one object shape keeps the thousands of overlap tests fast.
  const plain = (r: Rect): Rect => ({ x: r.x, y: r.y, w: r.w, h: r.h });
  const windows = (input.windows ?? []).map(plain);
  const prots = (input.windows ?? []).filter((o) => o.protected).map(plain);
  const hard = (input.hard ?? []).map(plain);
  const soft = (input.soft ?? []).map(plain);
  const memo = input.memo && input.memo.tokens === input.tokens ? input.memo : undefined;
  if (memo && !memo.plain) memo.plain = memo.tokens.map(plain);
  const tokens = memo?.plain ?? (input.tokens ?? []).map(plain);
  const base = fittedDefaultRect(def, vp, hard, input.size);
  if (def.fixedDefault)
    return { rect: base, clear: true, pcClear: pcClear(base, input.tokens ?? []) };
  const a = usableArea(vp);
  const g = input.gap ?? EDGE_GAP;
  const { w } = base;
  const need = Math.ceil(input.need ?? 0);
  const fullH = Math.min(Math.max(base.h, need), a.bottom - a.top);
  const floorH = Math.max(def.minSize.h, input.floor?.h ?? 0);
  const minH = Math.min(Math.max(floorH, need), fullH);
  const openH = def.minOpenH === undefined ? null : Math.max(minH, Math.min(def.minOpenH, fullH));
  // Moved windows stay right of the tool rail (FR-SHELL-109: always 68).
  const minX = Math.max(a.left, RAIL_CLEAR);
  const blockers: Rect[] = [...windows, ...hard];
  // "Clear" keeps the 12 px gap to every window and hard region.
  const padded = blockers.map((o) => ({ x: o.x - g, y: o.y - g, w: o.w + 2 * g, h: o.h + 2 * g }));
  const regions: Rect[] = [...windows, ...hard, ...soft];
  const heights = [fullH, minH, ...(openH === null ? [] : [openH])];
  // Rows come from the min height too when a floor is set (the spots a shrink would use).
  const rowHeights = [...new Set([...heights, Math.min(Math.max(def.minSize.h, need), fullH)])];
  const sizes = [...new Set(heights)];
  const titleBars = windows.map((o) => ({ x: o.x, y: o.y, w: o.w, h: TITLE_H }));
  if (memo && !memo.pcs) memo.pcs = pcBoxes(memo.tokens);
  const pcs = memo?.pcs ?? pcBoxes(input.tokens ?? []);
  /** The token half of the grid (FR-SHELL-58), memoised per settle (FR-SHELL-158). */
  const tokenGrid = (): TokenGrid => {
    // FR-SHELL-58: the footprints nearest the default rect give rows and columns too.
    const near = (t: Rect) => Math.abs(t.x - base.x) + Math.abs(t.y - base.y);
    const edgeTokens = [...tokens].sort((p, q) => near(p) - near(q)).slice(0, TOKEN_EDGES_MAX);
    // Footprints sit at fractional screen px; stored geometry is whole px, 12 px clear of them.
    const rows: number[] = [];
    for (const t of edgeTokens) {
      rows.push(Math.ceil(t.y + t.h + g));
      for (const h of rowHeights) rows.push(Math.floor(t.y - g - h));
    }
    const cols = edgeTokens.flatMap((t) => [Math.ceil(t.x + t.w + g), Math.floor(t.x - g - w)]);
    const drop = [
      ...[...new Set(cols)].map((v) => ({ v, d: Math.abs(v - base.x), x: true })),
      ...[...new Set(rows)].map((v) => ({ v, d: Math.abs(v - base.y), x: false })),
    ].sort((p, q) => q.d - p.d || p.v - q.v || Number(p.x) - Number(q.x));
    return { edgeTokens, rows, cols, drop };
  };
  const gridKey = `${base.x},${base.y},${w},${g},${rowHeights.join("/")}`;
  placeStats.searches += 1;
  let grid = memo?.grids.get(gridKey);
  if (!grid) {
    placeStats.grids += 1;
    grid = tokenGrid();
    memo?.grids.set(gridKey, grid);
  }
  const { edgeTokens } = grid;
  const fixedRows = [base.y, a.top, ...rowHeights.map((h) => a.bottom - h)];
  for (const o of regions) {
    fixedRows.push(o.y, o.y + o.h + g);
    for (const h of rowHeights) fixedRows.push(o.y - g - h);
  }
  /**
   * Inward columns for width `cw`: beside every region and token footprint (FR-SHELL-46, -58);
   * `k`: the same column at full width (what the spot cap kept).
   */
  const inwardCols = (cw: number) => [
    ...regions.flatMap((o) =>
      [o.x + o.w + g, o.x - g - cw].map((v) => ({ v, k: v, token: false })),
    ),
    ...edgeTokens.flatMap((t) => {
      const right = Math.ceil(t.x + t.w + g);
      const left = (cw2: number) => Math.floor(t.x - g - cw2);
      return [
        { v: right, k: right, token: true },
        { v: left(cw), k: left(w), token: true },
      ];
    }),
  ];
  const edges = (cw: number) => [base.x, minX, a.right - cw].map((v) => ({ v, token: false }));
  // `capSpots` on the full-width grid, its token drop order precomputed (same spots).
  const fixedCols = [
    ...edges(w).map((e) => e.v),
    ...regions.flatMap((o) => [o.x + o.w + g, o.x - g - w]),
  ];
  const spots = capGrid(fixedCols, grid.cols, fixedRows, grid.rows, grid.drop);
  const ys = spots.rows.sort((p, q) => p - q);
  const keptX = new Set(spots.cols);

  /** Free height below (x, y) for width `cw`, up to `max`; 0 if (x, y) itself is covered. */
  const freeHeight = (x: number, y: number, cw: number, max: number) => {
    let h = max;
    for (const o of blockers) {
      if (x >= o.x + o.w || o.x >= x + cw) continue;
      if (o.y <= y && y < o.y + o.h) return 0;
      if (o.y >= y) h = Math.min(h, o.y - y - g);
    }
    return Math.max(0, h);
  };

  /** What a column [x, x + cw] can touch (≤ 4,000 spots × a few heights; keep each cheap). */
  const inColumn = (x: number, cw: number) => {
    const across = <T extends Rect>(list: readonly T[]) => {
      const out: T[] = [];
      for (const o of list) if (o.x < x + cw && x < o.x + o.w) out.push(o);
      return out;
    };
    return {
      windows: across(windows),
      prots: across(prots),
      hard: across(hard),
      padded: across(padded),
      titleBars: across(titleBars),
      soft: across(soft),
      tokens: across(tokens),
      pcs: across(pcs),
    };
  };
  type Column = ReturnType<typeof inColumn>;

  /**
   * 1 when an edge of `r` runs through a PC footprint + 4 px (partly inside): among candidates that
   * must cover PCs, one that holds them whole ranks first (walkthrough WF1, edge-on-PC row).
   */
  const pcCut = (r: Rect, c: Column) => {
    for (const p of c.pcs) {
      if (!hits(r, p)) continue;
      const whole = p.x >= r.x && p.y >= r.y && p.x + p.w <= r.x + r.w && p.y + p.h <= r.y + r.h;
      if (!whole) return 1;
    }
    return 0;
  };
  /** PC footprint (+ 4 px) area under `r` (FR-SHELL-77 (e)). */
  const pcArea = (r: Rect, c: Column) => {
    let n = 0;
    for (const p of c.pcs) n += overlapArea(r, p);
    return n;
  };
  /**
   * The rank of `r` (header), in stages: when its first fields already lose to `bound` (the best
   * so far), only those are returned (most candidates stop there; (2) is always included).
   */
  const rank = (r: Rect, inward: boolean, c: Column, bound?: readonly number[]): number[] => {
    const pc = anyHit(r, c.pcs) ? 1 : 0;
    const clear = !anyHit(r, c.padded);
    if (!clear && bound?.[0] === 0) return [1, 0, 0, 0, 0, pc];
    let overlap = 0;
    let prot = 0;
    for (const o of c.windows) overlap += overlapArea(r, o);
    for (const o of c.prots) prot += overlapArea(r, o);
    for (const o of c.hard) overlap += overlapArea(r, o);
    const title = anyHit(r, c.titleBars) ? 1 : 0;
    const keepsOpenH = openH === null || (clear && r.h >= openH) ? 0 : 1;
    const head = [
      clear ? 0 : 1,
      prot > 0 ? 1 : 0,
      title,
      prot,
      overlap,
      pc,
      input.leastPc ? pcArea(r, c) : pcCut(r, c),
      keepsOpenH,
    ];
    const loses = () => bound !== undefined && lexLess(bound, head, head.length);
    if (loses()) return head;
    head.push(anyHit(r, c.tokens) ? 1 : 0, inward ? 1 : 0, anyHit(r, c.soft) ? 1 : 0);
    if (loses()) return head;
    const softArea = c.soft.reduce((n, s) => n + overlapArea(r, s), 0);
    const tokenArea = c.tokens.reduce((n, t) => n + overlapArea(r, t), 0);
    const full = r.h >= (openH ?? fullH) && r.w === w ? 0 : 1;
    const column = r.x === base.x ? 0 : 1;
    const dist = Math.abs(r.x - base.x) + Math.abs(r.y - base.y);
    const prev = input.prev ? Math.abs(r.x - input.prev.x) + Math.abs(r.y - input.prev.y) : 0;
    return [
      ...head,
      tokenArea,
      full,
      openH === null ? 0 : -r.h,
      column,
      prev,
      dist,
      -r.h,
      r.y,
      r.x,
      softArea,
    ];
  };

  let best: { rect: Rect; rank: number[] } | null = null;
  const seen = new Set<number>();
  const HEAD = 11; // fields of a rank cut short (`rank`)
  let narrowing = false;
  let narrowToClear = false;
  /** Some full-width candidate is clear (a PC cut narrower than that doesn't count). */
  let fullClear = false;
  let cur: Column = inColumn(base.x, w);
  const minW = Math.min(Math.max(def.minSize.w, input.floor?.w ?? 0), w);
  /**
   * A candidate over PC footprints (+ 4 px), cut (≥ min size) to end 12 px before the nearest
   * one on a side, never at a centre (FR-SHELL-57): narrower keeping its left or right edge,
   * shorter keeping its top or bottom (#245: cover only when no size avoids it), so rank (2)
   * beats (6) full size. A cut below min size is dropped.
   */
  const clearOfPcs = (r: Rect): Rect[] => {
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const p of cur.pcs) {
      if (!hits(r, p)) continue;
      left = Math.min(left, p.x);
      right = Math.max(right, p.x + p.w);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y + p.h);
    }
    if (left === Number.POSITIVE_INFINITY) return [];
    const out: Rect[] = [];
    const lw = Math.floor(left - g - r.x);
    if (lw >= minW) out.push({ ...r, w: lw });
    const rx = Math.ceil(right + g);
    if (r.x + r.w - rx >= minW) out.push({ ...r, x: rx, w: r.x + r.w - rx });
    const th = Math.floor(top - g - r.y);
    if (th >= minH) out.push({ ...r, h: th });
    const by = Math.ceil(bottom + g);
    if (r.y + r.h - by >= minH) out.push({ ...r, y: by, h: r.y + r.h - by });
    return out;
  };
  /**
   * Ranks `rect`; `cut`: made by `clearOfPcs` (several candidates can give the same one); `sweep`:
   * a grid spot of the least-PC-area sweep (no cuts of its own).
   */
  const consider = (rect: Rect, inward: boolean, cut = false, sweep = false): void => {
    if (cut) {
      // Whole px in ±4,096 (GEOMETRY_LIMIT): one exact number per (rect, inward).
      const k = (n: number) => n + 4096;
      const key = (((k(rect.x) * 8192 + k(rect.y)) * 8192 + k(rect.w)) * 8192 + k(rect.h)) * 2;
      if (seen.has(key + (inward ? 1 : 0))) return;
      seen.add(key + (inward ? 1 : 0));
    }
    const r = rank(rect, inward, cur, best?.rank);
    // Narrowed only to be clear: of windows when nothing at full width is (FR-SHELL-47 parks only
    // when no candidate is clear), else of every PC and token too.
    const fits = !narrowing || (r[0] === 0 && (narrowToClear || (r[5] === 0 && r[8] === 0)));
    if (!narrowing && rect.w === w && r[0] === 0) fullClear = true;
    if (fits && r.length > HEAD && (!best || lexLess(r, best.rank))) best = { rect, rank: r };
    if (r[5] === 1 && !sweep) for (const s of clearOfPcs(rect)) consider(s, inward, true);
  };
  const done = new Set<string>();
  /** Candidates in column x0 at width `cw`; `only`: that height only (the last resort). */
  const column = (x0: number, inward: boolean, cw = w, only?: number) => {
    const x = Math.max(minX, Math.min(x0, a.right - cw));
    const id = `${x},${cw},${inward},${only}`;
    if (done.has(id)) return; // token columns often clamp to the same x
    done.add(id);
    cur = inColumn(x, cw);
    // Rows ascend, so each height's clamped y never repeats once it stops changing.
    const hs = only === undefined ? sizes : [only];
    const last = hs.map(() => Number.NaN);
    let lastFree = Number.NaN;
    for (const y0 of ys) {
      const top = Math.max(a.top, y0);
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i] as number;
        const y = Math.min(top, a.bottom - h);
        if (y === last[i]) continue;
        last[i] = y;
        consider({ x, y, w: cw, h }, inward);
      }
      if (only !== undefined) continue;
      const y = Math.min(top, a.bottom - minH);
      if (y === lastFree) continue;
      lastFree = y;
      const free = Math.min(freeHeight(x, y, cw, a.bottom - y), fullH);
      if (free >= minH && !hs.includes(free)) consider({ x, y, w: cw, h: free }, inward);
    }
  };
  consider(base, false);
  const edgeXs = (cw: number) => new Set(edges(cw).map((e) => e.v));
  for (const x of edgeXs(w)) column(x, false);
  // FR-SHELL-46, -58: inward columns only when no edge candidate passes (1), (1b), (2), (2c).
  const passes = (r: number[]) => r[0] === 0 && r[5] === 0 && r[7] === 0 && r[8] === 0;
  const inwardXs = (cw: number) => {
    const xs = new Set<number>();
    for (const e of inwardCols(cw)) if (!e.token || keptX.has(e.k)) xs.add(e.v);
    return xs;
  };
  const bestRank = () => (best as { rank: number[] } | null)?.rank ?? [1];
  if (!passes(bestRank())) {
    for (const x of inwardXs(w)) column(x, true);
  }
  // No full-width spot clear and over no PC and no token: the same columns at min width, taken
  // where that is clear and over no token (FR-SHELL-58), or, when no full-width spot is clear at
  // all, where it is clear (tokens are rank (2) / (2c), never a reason to park; walkthrough
  // finding 2). A narrower window ranks (6).
  const tokenFree = (r: number[]) => r[0] === 0 && r[5] === 0 && r[8] === 0;
  if (minW < w && !tokenFree(bestRank())) {
    narrowing = true;
    narrowToClear = !fullClear;
    for (const x of edgeXs(minW)) column(x, false, minW);
    for (const x of inwardXs(minW)) column(x, true, minW);
    narrowing = false;
  }
  // FR-SHELL-77 (e): clear spots all over PCs → a 16-px sweep of the usable area at every size
  // finds the least PC area (the edge and token rows above only ever clear a footprint).
  if (input.leastPc && bestRank()[0] === 0 && bestRank()[5] === 1) {
    for (const cw of new Set([w, minW])) {
      for (let x = minX; x <= a.right - cw; x += 16) {
        cur = inColumn(x, cw);
        for (const h of sizes) {
          for (let y = a.top; y <= a.bottom - h; y += 16) {
            const r = { x, y, w: cw, h };
            if (!anyHit(r, cur.padded)) consider(r, true, false, true);
          }
        }
      }
    }
  }
  // FR-SHELL-45's last resort: min size (FR-SHELL-47 calls it once nothing is left to park).
  if (input.lastResort && minW < w && bestRank()[0] !== 0) {
    for (const x of edgeXs(minW)) column(x, false, minW, minH);
    for (const x of inwardXs(minW)) column(x, true, minW, minH);
  }
  const chosen = best as { rect: Rect; rank: number[] } | null;
  if (!chosen) return { rect: base, clear: true, pcClear: pcClear(base, input.tokens ?? []) };
  return {
    rect: chosen.rect,
    clear: chosen.rank[0] === 0,
    pcClear: chosen.rank[5] === 0,
    ...(chosen.rank[9] === 1 && { inward: true as const }),
  };
}

/** `a` < `b` lexicographically over the first `n` fields (default: all of `a`). */
function lexLess(a: readonly number[], b: readonly number[], n = a.length) {
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}
