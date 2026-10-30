// FR-FOG-37 (ADR-0076): explored memory as one exact shape per (scene, player). A sight polygon
// joins it only for what it really adds: `difference` first, and only pieces that aren't rounding
// noise are merged, so walking through seen ground writes nothing and sends nothing. Specks left
// by rounding (hairline holes, tiny pieces) are dropped: they would draw as faint cracks. A merge
// the library refuses is retried once on a coarser grid; if that fails too, that polygon isn't
// remembered and the row stays as it was (sight itself is untouched). Pure, except for the warning.
import { exploredMask, ringArea, shapeVertices } from "@shared/fog-of-war/explored";
import type { FogBox } from "@shared/fog-of-war/schemas";
import { EXPLORED_VERTICES_MAX, type ExploredShape } from "@shared/fog-of-war/schemas";
import polygonClipping, { type MultiPolygon, type Ring } from "polygon-clipping";
import { fogLog } from "./sight";

/** A new piece with less area than this (square cells) is noise; about 5 × 5 px on a 50 px cell. */
const NEW_AREA_MIN = 0.01;
/** A hole or piece with less area than this (square cells) is a speck. */
const SPECK_AREA = 0.05;
/** Mean width (cells) below which a ring is a hairline, whatever its area: 1 px on a 50 px cell. */
const HAIRLINE = 0.02;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Flat `[x, y, …]` → a closed ring, without vertices rounding made equal. */
function toRing(flat: readonly number[], round: (v: number) => number = r2): Ring {
  const ring: Ring = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = round(flat[i] as number);
    const y = round(flat[i + 1] as number);
    const last = ring.at(-1);
    if (!last || last[0] !== x || last[1] !== y) ring.push([x, y]);
  }
  const [first] = ring;
  if (first) ring.push([first[0], first[1]]);
  return ring;
}

/** A closed ring → flat, 2 decimals, no closing vertex. */
function toFlat(ring: Ring): number[] {
  const flat: number[] = [];
  for (let i = 0; i + 1 < ring.length; i++) {
    const p = ring[i] as [number, number];
    const x = r2(p[0]);
    const y = r2(p[1]);
    const n = flat.length;
    if (n >= 2 && flat[n - 2] === x && flat[n - 1] === y) continue;
    flat.push(x, y);
  }
  return flat;
}

const toMulti = (shape: ExploredShape): MultiPolygon =>
  shape.map((rings) => rings.map((r) => toRing(r)));

function perimeter(flat: readonly number[]): number {
  let p = 0;
  const n = flat.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    p += Math.hypot(
      (flat[2 * i] as number) - (flat[2 * j] as number),
      (flat[2 * i + 1] as number) - (flat[2 * j + 1] as number),
    );
  }
  return p;
}

/** Smaller than `area`, or thinner than a hairline (mean width ≈ 2 × area / perimeter)? */
function negligible(flat: readonly number[], area: number): boolean {
  if (flat.length < 6) return true;
  const a = ringArea(flat);
  return a < area || (2 * a) / perimeter(flat) < HAIRLINE;
}

/** The library's result as a stored shape, specks dropped. */
function toShape(m: MultiPolygon): ExploredShape {
  const out: ExploredShape = [];
  for (const rings of m) {
    const [outline, ...holes] = rings.map(toFlat);
    if (!outline || negligible(outline, SPECK_AREA)) continue;
    out.push([outline, ...holes.filter((h) => !negligible(h, SPECK_AREA))]);
  }
  return out;
}

/** Merges one polygon; null = it adds nothing. Throws what the library throws. */
function mergeOne(acc: ExploredShape, ring: Ring): ExploredShape | null {
  if (ring.length < 4) return null;
  const fresh = polygonClipping.difference([ring], toMulti(acc));
  const real = fresh.filter((rings) => {
    const outline = rings[0];
    return outline !== undefined && !negligible(toFlat(outline), NEW_AREA_MIN);
  });
  if (real.length === 0) return null;
  return toShape(polygonClipping.union(toMulti(acc), real));
}

/** The coarser grid of the one retry (0.05 cell). */
const coarse = (v: number) => Math.round(v * 20) / 20;

/**
 * FR-FOG-37: `prev` plus the sight polygons. Null = nothing new; `{full}` = at the cap (the row
 * stays, the memory stops growing; no merge is tried, they get slow and fail up there).
 */
export function growMemory(
  prev: ExploredShape,
  polys: readonly (readonly number[])[],
): { shape: ExploredShape } | { full: true } | null {
  if (shapeVertices(prev) >= EXPLORED_VERTICES_MAX) return { full: true };
  let acc = prev;
  let grew = false;
  for (const flat of polys) {
    let next: ExploredShape | null = null;
    try {
      next = mergeOne(acc, toRing(flat));
    } catch {
      try {
        next = mergeOne(acc, toRing(flat, coarse));
      } catch (err) {
        fogLog().warn(`fog: explored memory merge failed, polygon skipped: ${String(err)}`);
      }
    }
    if (next === null) continue;
    acc = next;
    grew = true;
  }
  if (!grew) return null;
  return shapeVertices(acc) > EXPLORED_VERTICES_MAX ? { full: true } : { shape: acc };
}

/** ADR-0076: an old per-cell row (box + runs) as a shape; its cells stay explored, whole. */
export function cellsToShape(row: { box: FogBox; runs: string }): ExploredShape {
  const mask = exploredMask(row);
  const [col0, row0, cols, rows] = mask.box;
  const rects: MultiPolygon = [];
  for (let r = 0; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && mask.cells[r * cols + c] === 1;
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        const [x0, x1, y0, y1] = [col0 + start, col0 + c, row0 + r, row0 + r + 1];
        rects.push([
          [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
            [x0, y0],
          ],
        ]);
        start = -1;
      }
    }
  }
  const [first, ...rest] = rects;
  if (!first) return [];
  return toShape(polygonClipping.union([first], ...rest.map((p) => [p])));
}
