// Explored memory (FR-FOG-37, ADR-0076): the `fog-explored` row's exact shape, in grid units:
// polygons → rings (the first is the outline, the others its holes) → flat `[x, y, …]`, no closing
// vertex. Pieces never overlap. The merge lives on the server (`memory-shape.ts`); this is what
// both sides read. `exploredMask` decodes the old per-cell rows, for their conversion only. Pure.
import { decodeRuns, type FogMask } from "./mask";
import type { ExploredShape, FogBox } from "./schemas";
import { pointInPolygon } from "./vision";

export function exploredMask(row: { box: FogBox; runs: string }): FogMask {
  const n = row.box[2] * row.box[3];
  const cells = decodeRuns(row.runs, n, "clear") ?? new Uint8Array(n);
  return { fill: "clear", box: row.box, cells };
}

/** Is the point (grid units) explored? Inside an outline and in none of its holes. */
export function shapeHolds(shape: ExploredShape, x: number, y: number): boolean {
  return shape.some(
    ([outline, ...holes]) =>
      outline !== undefined &&
      pointInPolygon(outline, x, y) &&
      !holes.some((h) => pointInPolygon(h, x, y)),
  );
}

/** A flat ring's area (always ≥ 0). */
export function ringArea(flat: readonly number[]): number {
  let a = 0;
  const n = flat.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a +=
      (flat[2 * j] as number) * (flat[2 * i + 1] as number) -
      (flat[2 * i] as number) * (flat[2 * j + 1] as number);
  }
  return Math.abs(a) / 2;
}

/** The explored area in square cells: outlines minus holes. */
export function shapeArea(shape: ExploredShape): number {
  let a = 0;
  for (const [outline, ...holes] of shape) {
    if (outline === undefined) continue;
    a += ringArea(outline);
    for (const h of holes) a -= ringArea(h);
  }
  return a;
}

/** How many vertices the shape holds (its cap: `EXPLORED_VERTICES_MAX`). */
export function shapeVertices(shape: ExploredShape): number {
  let n = 0;
  for (const rings of shape) for (const r of rings) n += r.length >> 1;
  return n;
}
