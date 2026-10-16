// FOG v2 vision (FR-FOG-32–34, -36, -46; ADR-0042 pick 2A, hand-rolled, OQ-FOG-29 A). Pure;
// shared by the server (re-derive, `seenBy`, the `vision` record) and the DM client (View as).
// Grid units in and out; the sweep runs on 1/100-cell integer coordinates.
//
// API
// - `sightPolygon(origin, r, occluders) → number[] | null`: the visibility polygon from `origin`
//   (flat `[x, y, …]`, rounded once to 2 decimals) bounded by a 64-gon of radius `r` cells, cut by
//   `occluders` (raw segments or `prepareOccluders(...)`). r ≤ 0 → null. A segment through the
//   origin (origin on a wall, or on its line) never occludes: both sides are seen, every other
//   occluder still cuts beyond. `sightPolygons(origin, radii, occluders)`: the same for several
//   radii from one sweep (a source's `see` and `dark`, FR-FOG-33).
// - `prepareOccluders(segs)`: scaled segments + their pairwise crossings, computed once per scene
//   and shared by every source (the angular sweep needs crossings as events).
// - `prepareScene(walls, darkness) → SceneOccluders`: walls + non-open doors (scene-tools
//   `sightOccluders`), and the same plus darkness edges for sources without see-through.
// - `playerVision(scene, sources) → PlayerVision`: one player's sources (≤ `SOURCES_MAX`, the
//   caller picks the oldest 4, FR-FOG-32) → blind flag, `see` / `dark` polygons, `inv` indices
//   into `see ++ dark` of Sees-invisible sources (FR-FOG-39), and `polys` with flags + a fast
//   containment test.
// - `prepareStaticLayer(mask, shapes, darkness)` + `samplePoint(layer, x, y)`: a point's static
//   state + darkness (FR-FOG-01, -28), computed once per re-derive, not per player (FR-FOG-35).
// - `pointVisible(vision, pt)` (FR-FOG-34) and `invisibleSeen(vision, pt)` (FR-FOG-46).
// - `pointInPolygon(flat, x, y)` (boundary-inclusive, even-odd), `polygonCells(flat, visit)`
//   (cells whose centre is inside or on the polygon: explored memory, FR-FOG-37).
import type { FogMask } from "./mask";
import {
  type FogShapeOp,
  type PreparedShape,
  preparedContains,
  prepareShape,
  type ShapeLike,
  type StaticState,
  shapeContains,
  shapeEdges,
} from "./shapes";

/** A segment `[x1, y1, x2, y2]` in grid units. */
export type Seg = readonly [x1: number, y1: number, x2: number, y2: number];

/** CHARX FR-CHARX-49 / -53: a creature's senses (absent = all 0 / false). */
export interface Senses {
  visionFt: number;
  darkvisionFt: number;
  seesMagicalDarkness: boolean;
  seesInvisible?: boolean;
}

export const NO_SENSES: Senses = { visionFt: 0, darkvisionFt: 0, seesMagicalDarkness: false };

/** FR-FOG-33: the sight bound is a regular polygon with this many sides. */
export const SIGHT_SIDES = 64;
/** FR-FOG-32: senses ≤ 120 ft → reach ≤ 24 cells. */
export const SENSE_FT_MAX = 120;
export const REACH_MAX_CELLS = 24;
/** FR-FOG-32 (OQ-FOG-35): ≤ 4 sources per player (oldest `seq` first; the caller cuts). */
export const SOURCES_MAX = 4;
const FT_PER_CELL = 5;
/** Grid units → integers. */
const K = 100;
const TWO_PI = 2 * Math.PI;

// ---------- prepared occluders ----------

/** Scaled segments (×100, flat `ax, ay, bx, by`) and their proper crossings (flat `x, y`). */
export interface PreparedOccluders {
  readonly segs: Float64Array;
  readonly crossings: Float64Array;
}

const sc = (v: number) => Math.round(v * K);

/**
 * Scales the segments and finds every proper crossing between two of them: a uniform grid of
 * 2-cell buckets, only pairs sharing a bucket are tested, and a crossing is reported by the one
 * bucket that contains it (no duplicates). Shared by every source of a scene.
 */
export function prepareOccluders(list: readonly Seg[]): PreparedOccluders {
  const n = list.length;
  const segs = new Float64Array(4 * n);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const s = list[i] as Seg;
    const ax = sc(s[0]);
    const ay = sc(s[1]);
    const bx = sc(s[2]);
    const by = sc(s[3]);
    segs[4 * i] = ax;
    segs[4 * i + 1] = ay;
    segs[4 * i + 2] = bx;
    segs[4 * i + 3] = by;
    minX = Math.min(minX, ax, bx);
    minY = Math.min(minY, ay, by);
    maxX = Math.max(maxX, ax, bx);
    maxY = Math.max(maxY, ay, by);
  }
  if (n < 2) return { segs, crossings: new Float64Array(0) };
  let B = 2 * K;
  while (((maxX - minX) / B + 1) * ((maxY - minY) / B + 1) > 1 << 20) B *= 2;
  const c0 = Math.floor(minX / B);
  const r0 = Math.floor(minY / B);
  const W = Math.floor(maxX / B) - c0 + 1;
  const H = Math.floor(maxY / B) - r0 + 1;
  // Cells of each segment (bbox; a long one keeps only cells its line passes near).
  const cellsOf = (i: number, visit: (cell: number) => void) => {
    const ax = segs[4 * i] as number;
    const ay = segs[4 * i + 1] as number;
    const bx = segs[4 * i + 2] as number;
    const by = segs[4 * i + 3] as number;
    const x0 = Math.floor(Math.min(ax, bx) / B) - c0;
    const x1 = Math.floor(Math.max(ax, bx) / B) - c0;
    const y0 = Math.floor(Math.min(ay, by) / B) - r0;
    const y1 = Math.floor(Math.max(ay, by) / B) - r0;
    const long = (x1 - x0 + 1) * (y1 - y0 + 1) > 16;
    const len = Math.hypot(bx - ax, by - ay);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (long) {
          const cx = (x + c0 + 0.5) * B;
          const cy = (y + r0 + 0.5) * B;
          if (Math.abs((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / len > B) continue;
        }
        visit(y * W + x);
      }
    }
  };
  const start = new Int32Array(W * H + 1);
  for (let i = 0; i < n; i++)
    cellsOf(i, (c) => {
      start[c + 1] = (start[c + 1] as number) + 1;
    });
  for (let c = 0; c < W * H; c++) start[c + 1] = (start[c + 1] as number) + (start[c] as number);
  const fill = start.slice(0, W * H);
  const items = new Int32Array(start[W * H] as number);
  for (let i = 0; i < n; i++)
    cellsOf(i, (c) => {
      items[fill[c] as number] = i;
      fill[c] = (fill[c] as number) + 1;
    });
  const out: number[] = [];
  for (let c = 0; c < W * H; c++) {
    const a0 = start[c] as number;
    const a1 = start[c + 1] as number;
    if (a1 - a0 < 2) continue;
    const cx = c % W;
    const cy = (c - cx) / W;
    for (let a = a0; a < a1; a++) {
      for (let b = a + 1; b < a1; b++) {
        const x = properCrossing(segs, items[a] as number, items[b] as number);
        if (!x) continue;
        // Report from the bucket holding the crossing only.
        if (Math.floor(x[0] / B) - c0 !== cx || Math.floor(x[1] / B) - r0 !== cy) continue;
        out.push(x[0], x[1]);
      }
    }
  }
  return { segs, crossings: Float64Array.from(out) };
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));

/** The crossing point of two segments that cross properly (exact test on integers), else null. */
function properCrossing(s: Float64Array, i: number, j: number): [number, number] | null {
  const ax = s[4 * i] as number;
  const ay = s[4 * i + 1] as number;
  const bx = s[4 * i + 2] as number;
  const by = s[4 * i + 3] as number;
  const cx = s[4 * j] as number;
  const cy = s[4 * j + 1] as number;
  const dx = s[4 * j + 2] as number;
  const dy = s[4 * j + 3] as number;
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  if (o1 * o2 >= 0) return null;
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (o3 * o4 >= 0) return null;
  const ex = bx - ax;
  const ey = by - ay;
  const fx = dx - cx;
  const fy = dy - cy;
  const t = ((cx - ax) * fy - (cy - ay) * fx) / (ex * fy - ey * fx);
  return [ax + t * ex, ay + t * ey];
}

// ---------- the sweep (FR-FOG-33) ----------

/** The bound: a regular 64-gon of radius `R` (scaled) around the origin, integer vertices. */
function boundRing(R: number): Float64Array {
  const ring = new Float64Array(2 * SIGHT_SIDES);
  for (let k = 0; k < SIGHT_SIDES; k++) {
    const a = (TWO_PI * k) / SIGHT_SIDES;
    ring[2 * k] = Math.round(R * Math.cos(a));
    ring[2 * k + 1] = Math.round(R * Math.sin(a));
  }
  return ring;
}

/** FR-FOG-33 bound polygon (grid units, flat): what an empty room's sight polygon equals. */
export function boundPolygon(origin: { x: number; y: number }, r: number): number[] {
  const ring = boundRing(r * K);
  const ox = sc(origin.x);
  const oy = sc(origin.y);
  const out: number[] = [];
  for (let k = 0; k < SIGHT_SIDES; k++) {
    out.push((ox + (ring[2 * k] as number)) / K, (oy + (ring[2 * k + 1] as number)) / K);
  }
  return out;
}

/** Clips the segment (origin-relative) to the convex ring (Cyrus–Beck); null when outside. */
function clipToRing(
  ring: Float64Array,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (let k = 0; k < SIGHT_SIDES; k++) {
    const px = ring[2 * k] as number;
    const py = ring[2 * k + 1] as number;
    const k2 = (k + 1) % SIGHT_SIDES;
    const ex = (ring[2 * k2] as number) - px;
    const ey = (ring[2 * k2 + 1] as number) - py;
    // Inside = left of p → q (CCW ring): cross(q − p, x − p) ≥ 0.
    const num = ex * (ay - py) - ey * (ax - px);
    const den = ex * dy - ey * dx;
    if (den === 0) {
      if (num < 0) return null;
      continue;
    }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/** First index `i` with `a[i] ≥ v` (a sorted ascending). */
function lowerBound(a: Float64Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] as number) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Kept segments, origin-relative, oriented so the sweep runs a → b (CCW); ring edges last. */
interface Kept {
  ax: Float64Array;
  ay: Float64Array;
  bx: Float64Array;
  by: Float64Array;
  /** Lower bound of each segment's distance from the origin. */
  dmin: Float64Array;
  n: number;
}

/** Pass 1 reach (scaled): occluders this near bound how far the sweep must look. */
const NEAR = 4 * K;
/** Angular bins for the pass-1 bound. */
const BINS = 512;
const BIN_W = TWO_PI / BINS;

const angle = (x: number, y: number) => {
  const a = Math.atan2(y, x);
  return a < 0 ? a + TWO_PI : a;
};

/** Calls `visit(bin)` for every bin the CCW arc a → b touches. */
function arcBins(a: number, b: number, visit: (bin: number) => void) {
  const b0 = Math.min(BINS - 1, Math.floor(a / BIN_W));
  const b1 = Math.min(BINS - 1, Math.floor(b / BIN_W));
  if (b1 >= b0 && b - a < Math.PI) {
    for (let k = b0; k <= b1; k++) visit(k);
    return;
  }
  for (let k = b0; k < BINS; k++) visit(k);
  for (let k = 0; k <= b1; k++) visit(k);
}

/**
 * The raw sweep: origin `(ox, oy)` and radius `R` scaled; `segs` absolute scaled segments;
 * returns the boundary as origin-relative points (unrounded, angle order). Segments beyond `R`
 * are culled first (FOG §12 fallback); segments on the origin's line never occlude. Two passes:
 * pass 1 sweeps only the occluders within 4 cells (no crossings: its boundary can only be
 * farther than the true one, so it is an upper bound per direction); pass 2 sweeps only the
 * occluders that come nearer than that bound somewhere in their angular span (the others are
 * never the nearest), with their crossings. Same result as one sweep over everything.
 */
function sweep(
  ox: number,
  oy: number,
  R: number,
  segs: Float64Array,
  crossings: Float64Array | null,
): number[] {
  const ring = boundRing(R);
  const inR2 = (R * Math.cos(Math.PI / SIGHT_SIDES) - 2) ** 2;
  const R2 = (R + 2) * (R + 2);
  const cap = segs.length / 4 + SIGHT_SIDES;
  // Kept segments, origin-relative, oriented so the sweep runs a → b (CCW).
  const sAx = new Float64Array(cap);
  const sAy = new Float64Array(cap);
  const sBx = new Float64Array(cap);
  const sBy = new Float64Array(cap);
  /** Lower bound of each segment's distance from the origin (for the banded nearest search). */
  const sDmin = new Float64Array(cap);
  let nSeg = 0;
  for (let i = 0; i < segs.length; i += 4) {
    let ax = (segs[i] as number) - ox;
    let ay = (segs[i + 1] as number) - oy;
    let bx = (segs[i + 2] as number) - ox;
    let by = (segs[i + 3] as number) - oy;
    const ex = bx - ax;
    const ey = by - ay;
    const ll = ex * ex + ey * ey;
    let t = ll === 0 ? 0 : -(ax * ex + ay * ey) / ll;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + t * ex;
    const py = ay + t * ey;
    const dmin2 = px * px + py * py;
    if (dmin2 > R2) continue;
    const c = ax * by - ay * bx;
    if (c === 0) continue; // through the origin or on its line: never occludes
    if (ax * ax + ay * ay > inR2 || bx * bx + by * by > inR2) {
      const cl = clipToRing(ring, ax, ay, bx, by);
      if (!cl) continue;
      [ax, ay, bx, by] = cl;
    }
    if (c > 0) {
      sAx[nSeg] = ax;
      sAy[nSeg] = ay;
      sBx[nSeg] = bx;
      sBy[nSeg] = by;
    } else {
      sAx[nSeg] = bx;
      sAy[nSeg] = by;
      sBx[nSeg] = ax;
      sBy[nSeg] = ay;
    }
    sDmin[nSeg] = Math.sqrt(dmin2);
    nSeg++;
  }
  // Ring edges join as segments (vertex k → k + 1 runs CCW).
  for (let k = 0; k < SIGHT_SIDES; k++) {
    const k2 = (k + 1) % SIGHT_SIDES;
    sAx[nSeg] = ring[2 * k] as number;
    sAy[nSeg] = ring[2 * k + 1] as number;
    sBx[nSeg] = ring[2 * k2] as number;
    sBy[nSeg] = ring[2 * k2 + 1] as number;
    sDmin[nSeg] = R * Math.cos(Math.PI / SIGHT_SIDES) - 1;
    nSeg++;
  }
  const kept: Kept = { ax: sAx, ay: sAy, bx: sBx, by: sBy, dmin: sDmin, n: nSeg };
  const nWalls = nSeg - SIGHT_SIDES;
  let far = 0;
  for (let i = 0; i < nWalls; i++) if ((sDmin[i] as number) > NEAR) far++;
  if (far === 0) return core(kept, null, crossings, ox, oy, R, R2);

  // Pass 1: near occluders + the ring, no crossings → an upper bound per angular bin.
  const near: number[] = [];
  for (let i = 0; i < nSeg; i++) if (i >= nWalls || (sDmin[i] as number) <= NEAR) near.push(i);
  const out1 = core(kept, near, null, ox, oy, R, R2);
  const bound = new Float64Array(BINS);
  for (let k = 0; k < out1.length; k += 4) {
    const x0 = out1[k] as number;
    const y0 = out1[k + 1] as number;
    const x1 = out1[k + 2] as number;
    const y1 = out1[k + 3] as number;
    const d = Math.max(Math.hypot(x0, y0), Math.hypot(x1, y1)) + 2;
    arcBins(angle(x0, y0), angle(x1, y1), (b) => {
      if ((bound[b] as number) < d) bound[b] = d;
    });
  }
  // Pass 2: every occluder that comes nearer than the bound somewhere in its span.
  const pick: number[] = [];
  let reach = 0;
  for (let i = 0; i < nSeg; i++) {
    if (i >= nWalls || (sDmin[i] as number) <= NEAR) {
      pick.push(i);
      continue;
    }
    let maxB = 0;
    arcBins(
      angle(sAx[i] as number, sAy[i] as number),
      angle(sBx[i] as number, sBy[i] as number),
      (b) => {
        if ((bound[b] as number) > maxB) maxB = bound[b] as number;
      },
    );
    if ((sDmin[i] as number) <= maxB) pick.push(i);
  }
  for (let b = 0; b < BINS; b++) reach = Math.max(reach, bound[b] as number);
  return core(kept, pick, crossings, ox, oy, R, Math.min(R2, reach * reach));
}

/**
 * One angular sweep over the kept segments `pick` (all when null). Events are the directions of
 * every endpoint, crossing (within `cross2` squared distance) and bound vertex; in each wedge
 * between consecutive directions the nearest segment along the mid ray is the boundary (no
 * endpoint or crossing inside a wedge, so the order of the segments there is fixed).
 */
function core(
  kept: Kept,
  pick: readonly number[] | null,
  crossings: Float64Array | null,
  ox: number,
  oy: number,
  R: number,
  cross2: number,
): number[] {
  let sAx = kept.ax;
  let sAy = kept.ay;
  let sBx = kept.bx;
  let sBy = kept.by;
  let sDmin = kept.dmin;
  let nSeg = kept.n;
  if (pick) {
    nSeg = pick.length;
    sAx = new Float64Array(nSeg);
    sAy = new Float64Array(nSeg);
    sBx = new Float64Array(nSeg);
    sBy = new Float64Array(nSeg);
    sDmin = new Float64Array(nSeg);
    for (let j = 0; j < nSeg; j++) {
      const i = pick[j] as number;
      sAx[j] = kept.ax[i] as number;
      sAy[j] = kept.ay[i] as number;
      sBx[j] = kept.bx[i] as number;
      sBy[j] = kept.by[i] as number;
      sDmin[j] = kept.dmin[i] as number;
    }
  }
  // Event angles: segment i's endpoints are events 2i, 2i + 1; crossings in reach follow.
  let nCross = 0;
  const cr = crossings ?? new Float64Array(0);
  const crAng: number[] = [];
  for (let i = 0; i < cr.length; i += 2) {
    const x = (cr[i] as number) - ox;
    const y = (cr[i + 1] as number) - oy;
    const d2 = x * x + y * y;
    if (d2 > cross2 || d2 < 1e-9) continue;
    const a = Math.atan2(y, x);
    crAng.push(a < 0 ? a + TWO_PI : a);
    nCross++;
  }
  const nEv = 2 * nSeg + nCross;
  const ang = new Float64Array(nEv);
  for (let i = 0; i < nSeg; i++) {
    const a = Math.atan2(sAy[i] as number, sAx[i] as number);
    const b = Math.atan2(sBy[i] as number, sBx[i] as number);
    ang[2 * i] = a < 0 ? a + TWO_PI : a;
    ang[2 * i + 1] = b < 0 ? b + TWO_PI : b;
  }
  for (let i = 0; i < nCross; i++) ang[2 * nSeg + i] = crAng[i] as number;
  const sorted = ang.slice().sort();

  // Distinct directions: integer directions differ by ≫ 1e-12 rad; equal ones by a few ulps.
  const groupOfRank = new Int32Array(nEv);
  const gAng: number[] = [];
  for (let k = 0; k < nEv; k++) {
    const a = sorted[k] as number;
    if (gAng.length === 0 || a - (gAng[gAng.length - 1] as number) > 1e-12) gAng.push(a);
    groupOfRank[k] = gAng.length - 1;
  }
  let m = gAng.length;
  // The last direction may equal the first across 2π.
  if (m > 1 && (gAng[0] as number) + TWO_PI - (gAng[m - 1] as number) <= 1e-12) {
    for (let k = 0; k < nEv; k++) if (groupOfRank[k] === m - 1) groupOfRank[k] = 0;
    m -= 1;
  }
  const gx = new Float64Array(m);
  const gy = new Float64Array(m);
  for (let g = 0; g < m; g++) {
    gx[g] = Math.cos(gAng[g] as number);
    gy[g] = Math.sin(gAng[g] as number);
  }
  const groupOf = (e: number) => groupOfRank[lowerBound(sorted, ang[e] as number)] as number;

  // Active sets per wedge: segment i spans groups [start, end) cyclically (CSR add / remove).
  const segStart = new Int32Array(nSeg);
  const segEnd = new Int32Array(nSeg);
  const addN = new Int32Array(m + 1);
  const remN = new Int32Array(m + 1);
  // The active set, banded by distance: the nearest search scans near bands first and stops
  // at the first band starting beyond the best hit so far.
  const NB = 16;
  const BW = (R + 2) / NB;
  const bandOf = new Int32Array(nSeg);
  for (let i = 0; i < nSeg; i++)
    bandOf[i] = Math.min(NB - 1, Math.floor((sDmin[i] as number) / BW));
  const pos = new Int32Array(nSeg).fill(-1);
  const active = new Int32Array(NB * nSeg);
  const nBand = new Int32Array(NB);
  const add = (i: number) => {
    const b = bandOf[i] as number;
    const n = nBand[b] as number;
    pos[i] = n;
    active[b * nSeg + n] = i;
    nBand[b] = n + 1;
  };
  const remove = (i: number) => {
    const p = pos[i] as number;
    if (p < 0) return;
    const b = bandOf[i] as number;
    const n = (nBand[b] as number) - 1;
    nBand[b] = n;
    const last = active[b * nSeg + n] as number;
    if (last !== i) {
      active[b * nSeg + p] = last;
      pos[last] = p;
    }
    pos[i] = -1;
  };
  for (let i = 0; i < nSeg; i++) {
    const g0 = groupOf(2 * i);
    const g1 = groupOf(2 * i + 1);
    segStart[i] = g0;
    segEnd[i] = g1;
    if (g0 === g1) continue;
    addN[g0 + 1] = (addN[g0 + 1] as number) + 1;
    remN[g1 + 1] = (remN[g1 + 1] as number) + 1;
    if (g0 > g1) add(i);
  }
  for (let g = 0; g < m; g++) {
    addN[g + 1] = (addN[g + 1] as number) + (addN[g] as number);
    remN[g + 1] = (remN[g + 1] as number) + (remN[g] as number);
  }
  const addL = new Int32Array(addN[m] as number);
  const remL = new Int32Array(remN[m] as number);
  const addF = addN.slice(0, m);
  const remF = remN.slice(0, m);
  for (let i = 0; i < nSeg; i++) {
    const g0 = segStart[i] as number;
    const g1 = segEnd[i] as number;
    if (g0 === g1) continue;
    addL[addF[g0] as number] = i;
    addF[g0] = (addF[g0] as number) + 1;
    remL[remF[g1] as number] = i;
    remF[g1] = (remF[g1] as number) + 1;
  }
  // Per segment: direction e = b − a and numerator a × e; hit along u: t = (a × e) / (u × e).
  const sEx = new Float64Array(nSeg);
  const sEy = new Float64Array(nSeg);
  const sNum = new Float64Array(nSeg);
  for (let i = 0; i < nSeg; i++) {
    const ex = (sBx[i] as number) - (sAx[i] as number);
    const ey = (sBy[i] as number) - (sAy[i] as number);
    sEx[i] = ex;
    sEy[i] = ey;
    sNum[i] = (sAx[i] as number) * ey - (sAy[i] as number) * ex;
  }

  const out: number[] = [];
  const Rmax = R * 1.01;
  for (let g = 0; g < m; g++) {
    for (let k = remN[g] as number; k < (remN[g + 1] as number); k++) remove(remL[k] as number);
    for (let k = addN[g] as number; k < (addN[g + 1] as number); k++) add(addL[k] as number);
    const g2 = g + 1 === m ? 0 : g + 1;
    const u0x = gx[g] as number;
    const u0y = gy[g] as number;
    const u1x = gx[g2] as number;
    const u1y = gy[g2] as number;
    let mx = u0x + u1x;
    let my = u0y + u1y;
    if (m === 1 || mx * mx + my * my < 1e-18) {
      mx = -u0y;
      my = u0x;
    }
    const ml = Math.hypot(mx, my);
    mx /= ml;
    my /= ml;
    let best = -1;
    let bestT = Number.POSITIVE_INFINITY;
    for (let b = 0; b < NB && b * BW < bestT; b++) {
      const base = b * nSeg;
      const end = base + (nBand[b] as number);
      for (let k = base; k < end; k++) {
        const i = active[k] as number;
        if ((sDmin[i] as number) >= bestT) continue;
        const den = mx * (sEy[i] as number) - my * (sEx[i] as number);
        if (den === 0) continue;
        const t = (sNum[i] as number) / den;
        if (t > 0 && t < bestT) {
          bestT = t;
          best = i;
        }
      }
    }
    if (best < 0) continue;
    const ex = sEx[best] as number;
    const ey = sEy[best] as number;
    const num = sNum[best] as number;
    const d0 = u0x * ey - u0y * ex;
    const d1 = u1x * ey - u1y * ex;
    const t0 = d0 === 0 ? Rmax : Math.min(num / d0, Rmax);
    const t1 = d1 === 0 ? Rmax : Math.min(num / d1, Rmax);
    out.push(u0x * t0, u0y * t0, u1x * t1, u1y * t1);
  }
  return out;
}

/** Rounds once to 2 decimals and drops repeated and collinear vertices (exact on integers). */
function finish(pts: readonly number[], ox: number, oy: number): number[] | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const pushPt = (x: number, y: number) => {
    const n = xs.length;
    if (n > 0 && xs[n - 1] === x && ys[n - 1] === y) return;
    while (xs.length >= 2) {
      const k = xs.length;
      const ax = xs[k - 2] as number;
      const ay = ys[k - 2] as number;
      const bx = xs[k - 1] as number;
      const by = ys[k - 1] as number;
      if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) !== 0) break;
      xs.pop();
      ys.pop();
    }
    xs.push(x);
    ys.push(y);
  };
  for (let i = 0; i < pts.length; i += 2) {
    pushPt(Math.round(ox + (pts[i] as number)), Math.round(oy + (pts[i + 1] as number)));
  }
  // Wrap-around: the first vertices against the last.
  let changed = true;
  while (changed && xs.length >= 3) {
    changed = false;
    const n = xs.length;
    if (xs[0] === xs[n - 1] && ys[0] === ys[n - 1]) {
      xs.pop();
      ys.pop();
      changed = true;
      continue;
    }
    for (const [a, b, c] of [
      [n - 2, n - 1, 0],
      [n - 1, 0, 1],
    ] as const) {
      const ax = xs[a] as number;
      const ay = ys[a] as number;
      const bx = xs[b] as number;
      const by = ys[b] as number;
      const cx = xs[c] as number;
      const cy = ys[c] as number;
      if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) === 0) {
        xs.splice(b, 1);
        ys.splice(b, 1);
        changed = true;
        break;
      }
    }
  }
  if (xs.length < 3) return null;
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++)
    out.push((xs[i] as number) / K + 0, (ys[i] as number) / K + 0);
  return out;
}

const prepOf = (occluders: readonly Seg[] | PreparedOccluders): PreparedOccluders =>
  "segs" in occluders ? occluders : prepareOccluders(occluders);

/** FR-FOG-33: the sight polygon (see the file header). */
export function sightPolygon(
  origin: { x: number; y: number },
  r: number,
  occluders: readonly Seg[] | PreparedOccluders,
): number[] | null {
  return sightPolygons(origin, [r], occluders)[0] ?? null;
}

/**
 * FR-FOG-33: sight polygons for several radii from one sweep at the largest; each smaller one is
 * that boundary (star-shaped from the origin) cut by its own 64-gon, a cheap second sweep. Same
 * result as separate sweeps (the 64-gons are nested).
 */
export function sightPolygons(
  origin: { x: number; y: number },
  radii: readonly number[],
  occluders: readonly Seg[] | PreparedOccluders,
): (number[] | null)[] {
  const rMax = Math.max(0, ...radii.filter((r) => r > 0));
  if (!(rMax > 0)) return radii.map(() => null);
  const prep = prepOf(occluders);
  const ox = sc(origin.x);
  const oy = sc(origin.y);
  const big = sweep(ox, oy, rMax * K, prep.segs, prep.crossings);
  let bigSegs: Float64Array | null = null;
  return radii.map((r) => {
    if (!(r > 0)) return null;
    if (r === rMax) return finish(big, ox, oy);
    if (!bigSegs) {
      const n = big.length / 2;
      bigSegs = new Float64Array(4 * n);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        bigSegs[4 * i] = ox + (big[2 * i] as number);
        bigSegs[4 * i + 1] = oy + (big[2 * i + 1] as number);
        bigSegs[4 * i + 2] = ox + (big[2 * j] as number);
        bigSegs[4 * i + 3] = oy + (big[2 * j + 1] as number);
      }
    }
    return finish(sweep(ox, oy, r * K, bigSegs, null), ox, oy);
  });
}

// ---------- point tests ----------

/** Boundary-inclusive even-odd point-in-polygon on a flat polygon (grid units). */
export function pointInPolygon(flat: readonly number[], x: number, y: number): boolean {
  const n = flat.length >> 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = flat[2 * i] as number;
    const ay = flat[2 * i + 1] as number;
    const bx = flat[2 * j] as number;
    const by = flat[2 * j + 1] as number;
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (
      Math.abs(cross) <= 1e-9 &&
      Math.min(ax, bx) - 1e-9 <= x &&
      x <= Math.max(ax, bx) + 1e-9 &&
      Math.min(ay, by) - 1e-9 <= y &&
      y <= Math.max(ay, by) + 1e-9
    ) {
      return true;
    }
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside;
  }
  return inside;
}

/**
 * Calls `visit(col, row)` for every cell whose centre lies inside or on the polygon (scanline;
 * explored memory, FR-FOG-37), row by row, columns ascending. Same answer as `pointInPolygon`
 * on the centre.
 */
export function polygonCells(flat: readonly number[], visit: (col: number, row: number) => void) {
  const n = flat.length >> 1;
  if (n < 3) return;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const y = flat[2 * i + 1] as number;
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const xs: number[] = [];
  for (let row = Math.floor(y0 - 0.5); row <= Math.ceil(y1); row++) {
    const yc = row + 0.5;
    if (yc < y0 - 1e-9 || yc > y1 + 1e-9) continue;
    xs.length = 0;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = flat[2 * i] as number;
      const ay = flat[2 * i + 1] as number;
      const bx = flat[2 * j] as number;
      const by = flat[2 * j + 1] as number;
      if (ay > yc !== by > yc) xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
      // Edges reaching this scanline: their centres may sit on the boundary.
      if (Math.min(ay, by) <= yc + 1e-9 && yc - 1e-9 <= Math.max(ay, by)) {
        lo = Math.min(lo, ax, bx);
        hi = Math.max(hi, ax, bx);
      }
    }
    xs.sort((a, b) => a - b);
    const cols = new Set<number>();
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.ceil((xs[k] as number) - 0.5 - 1e-9);
      const c1 = Math.floor((xs[k + 1] as number) - 0.5 + 1e-9);
      for (let c = c0; c <= c1; c++) cols.add(c);
    }
    if (lo <= hi) {
      for (let c = Math.ceil(lo - 0.5 - 1e-9); c <= Math.floor(hi - 0.5 + 1e-9); c++) {
        if (!cols.has(c) && pointInPolygon(flat, c + 0.5, yc)) cols.add(c);
      }
    }
    for (const c of [...cols].sort((a, b) => a - b)) visit(c, row);
  }
}

/**
 * A polygon's fast containment test: a grid of 1-cell squares marked inside / outside / boundary
 * (any edge's box touches it); points in boundary squares take the exact `pointInPolygon`.
 * Same answers as `pointInPolygon`.
 */
function polygonTester(flat: readonly number[]): (x: number, y: number) => boolean {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i] as number;
    const y = flat[i + 1] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const c0 = Math.floor(x0) - 1;
  const r0 = Math.floor(y0) - 1;
  const W = Math.floor(x1) - c0 + 2;
  const H = Math.floor(y1) - r0 + 2;
  // 0 outside, 1 inside, 2 boundary.
  const grid = new Uint8Array(W * H);
  const n = flat.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = flat[2 * i] as number;
    const ay = flat[2 * i + 1] as number;
    const bx = flat[2 * j] as number;
    const by = flat[2 * j + 1] as number;
    const cx0 = Math.floor(Math.min(ax, bx) - 1e-6) - c0;
    const cx1 = Math.floor(Math.max(ax, bx) + 1e-6) - c0;
    const cy0 = Math.floor(Math.min(ay, by) - 1e-6) - r0;
    const cy1 = Math.floor(Math.max(ay, by) + 1e-6) - r0;
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) grid[y * W + x] = 2;
  }
  polygonCells(flat, (c, r) => {
    const k = (r - r0) * W + (c - c0);
    if (grid[k] === 0) grid[k] = 1;
  });
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const k = (Math.floor(y) - r0) * W + (Math.floor(x) - c0);
    const g = grid[k];
    return g === 2 ? pointInPolygon(flat, x, y) : g === 1;
  };
}

// ---------- per player (FR-FOG-32–36, -46) ----------

/** A vision source: a token's footprint centre and its creature's senses (FR-FOG-32). */
export interface VisionSource {
  x: number;
  y: number;
  senses: Senses;
}

/** A scene's occluders, prepared once per re-derive. */
export interface SceneOccluders {
  /** Walls + doors not open (FR-SCN-37): sources that see through magical darkness. */
  walls: PreparedOccluders;
  /** + every darkness shape's edges: sources without see-through. */
  wallsAndDarkness: PreparedOccluders;
  darkness: readonly ShapeLike[];
}

export function prepareScene(
  walls: readonly Seg[],
  darkness: readonly ShapeLike[],
): SceneOccluders {
  const edges = darkness.flatMap((d) => shapeEdges(d));
  const w = prepareOccluders(walls);
  return {
    walls: w,
    wallsAndDarkness: edges.length === 0 ? w : prepareOccluders([...walls, ...edges]),
    darkness,
  };
}

/** One sight polygon with its source's flags and a fast containment test. */
export interface SightPoly {
  poly: number[];
  kind: "see" | "dark";
  seesThrough: boolean;
  seesInvisible: boolean;
  /** Same answers as `pointInPolygon(poly, x, y)`. */
  contains(x: number, y: number): boolean;
}

/** FR-FOG-36 / -39: one player's vision on a scene. */
export interface PlayerVision {
  blind: boolean;
  /** Rounded polygons (FR-FOG-33), source order. */
  see: number[][];
  dark: number[][];
  /** Indices into `see ++ dark` of polygons whose source sees invisible (FR-FOG-46). */
  inv: number[];
  /** `see ++ dark` with flags (same order as `inv` indexes). */
  polys: SightPoly[];
}

/** Sense radius in cells: ft / 5, clamped to 0–24. */
export const reachCells = (ft: number) => Math.max(0, Math.min(ft, SENSE_FT_MAX)) / FT_PER_CELL;

function sightPoly(
  poly: number[],
  kind: SightPoly["kind"],
  flags: { seesThrough: boolean; seesInvisible: boolean },
): SightPoly {
  let test: ((x: number, y: number) => boolean) | null = null;
  return {
    poly,
    kind,
    ...flags,
    contains(x, y) {
      test ??= polygonTester(poly);
      return test(x, y);
    },
  };
}

/** Does any source origin lie in darkness (edge included)? Per source. */
const originsInDarkness = (darkness: readonly ShapeLike[], sources: readonly VisionSource[]) =>
  sources.map((s) => darkness.some((d) => shapeContains(d, s.x, s.y)));

/**
 * FR-FOG-32–36: a player's sight. A source without see-through stops at darkness edges and has
 * no polygon while its origin is in darkness (edge included). Blind = ≥ 1 source, every origin
 * in darkness, none sees through (then no polygons at all).
 */
export function playerVision(
  scene: SceneOccluders,
  sources: readonly VisionSource[],
): PlayerVision {
  const inDark = originsInDarkness(scene.darkness, sources);
  const blind =
    sources.length > 0 &&
    inDark.every(Boolean) &&
    !sources.some((s) => s.senses.seesMagicalDarkness);
  const see: SightPoly[] = [];
  const dark: SightPoly[] = [];
  if (!blind) {
    sources.forEach((s, i) => {
      const through = s.senses.seesMagicalDarkness;
      if (!through && inDark[i]) return;
      const occ = through ? scene.walls : scene.wallsAndDarkness;
      const flags = { seesThrough: through, seesInvisible: s.senses.seesInvisible === true };
      const [p1, p2] = sightPolygons(
        s,
        [reachCells(s.senses.visionFt), reachCells(s.senses.darkvisionFt)],
        occ,
      );
      if (p1) see.push(sightPoly(p1, "see", flags));
      if (p2) dark.push(sightPoly(p2, "dark", flags));
    });
  }
  const polys = [...see, ...dark];
  const inv: number[] = [];
  polys.forEach((p, i) => {
    if (p.seesInvisible) inv.push(i);
  });
  return { blind, see: see.map((p) => p.poly), dark: dark.map((p) => p.poly), inv, polys };
}

// ---------- static layer (FR-FOG-01, -28) ----------

/** A scene's static layer: base mask + prepared fog shapes (with their op) + darkness. */
export interface StaticLayer {
  mask: FogMask;
  shapes: { op: FogShapeOp; p: PreparedShape }[];
  darkness: PreparedShape[];
}

export function prepareStaticLayer(
  mask: FogMask,
  shapes: readonly (ShapeLike & { op: FogShapeOp })[],
  darkness: readonly ShapeLike[],
): StaticLayer {
  return {
    mask,
    shapes: shapes.map((s) => ({ op: s.op, p: prepareShape(s) })),
    darkness: darkness.map(prepareShape),
  };
}

/** Box reject with a margin past the 1/100-cell rounding `shapeContains` applies. */
const inBox = (b: [number, number, number, number], x: number, y: number) =>
  x >= b[0] - 0.006 && x <= b[2] + 0.006 && y >= b[1] - 0.006 && y <= b[3] + 0.006;

/** A sample point with its static state and darkness, computed once per re-derive. */
export interface SamplePoint {
  x: number;
  y: number;
  state: StaticState;
  dark: boolean;
}

/** FR-FOG-01 (as `shapes.ts` `staticState`) + FR-FOG-28 for one point. */
export function samplePoint(layer: StaticLayer, x: number, y: number): SamplePoint {
  const [col0, row0, cols, rows] = layer.mask.box;
  const c = Math.floor(x) - col0;
  const r = Math.floor(y) - row0;
  const base =
    c < 0 || r < 0 || c >= cols || r >= rows
      ? layer.mask.fill === "fog"
      : layer.mask.cells[r * cols + c] === 1;
  let state: StaticState = base ? "fog" : "clear";
  const px = Math.round(x * 100);
  const py = Math.round(y * 100);
  for (const { op, p } of layer.shapes) {
    if (!inBox(p.box, x, y) || !preparedContains(p, px, py)) continue;
    state = op === "reveal" ? "clear" : op;
  }
  let dark = false;
  for (const p of layer.darkness) {
    if (inBox(p.box, x, y) && preparedContains(p, px, py)) {
      dark = true;
      break;
    }
  }
  return { x, y, state, dark };
}

/**
 * FR-FOG-34: P not blind and either the point is statically clear and not in darkness, or it
 * lies in one of P's polygons (a polygon without see-through never counts inside darkness).
 * Explored counts as hidden for records.
 */
export function pointVisible(v: PlayerVision, pt: SamplePoint): boolean {
  if (v.blind) return false;
  if (pt.state === "clear" && !pt.dark) return true;
  return v.polys.some((p) => (p.seesThrough || !pt.dark) && p.contains(pt.x, pt.y));
}

/**
 * FR-FOG-46: an unowned invisible token's sample point is seen by P only inside a polygon of a
 * Sees-invisible source (static clear, Explored and memory never count; blind sees nothing).
 */
export function invisibleSeen(v: PlayerVision, pt: SamplePoint): boolean {
  if (v.blind) return false;
  return v.polys.some(
    (p) => p.seesInvisible && (p.seesThrough || !pt.dark) && p.contains(pt.x, pt.y),
  );
}
