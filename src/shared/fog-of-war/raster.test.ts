import { describe, expect, test } from "bun:test";
import { cellFogged, type FogMask, uniformMask } from "./mask";
import { applyShape, forEachShapeCell, polygonProblem } from "./raster";
import type { FogShape } from "./schemas";

const listCells = (shape: FogShape) => {
  const out: string[] = [];
  forEachShapeCell(shape, (c, r) => out.push(`${c},${r}`));
  return out.sort();
};
const poly = (...points: [number, number][]): FogShape => ({ kind: "polygon", points });
const clearCells = (m: FogMask) => {
  const out: string[] = [];
  const [col0, row0, cols, rows] = m.box;
  for (let r = row0; r < row0 + rows; r++) {
    for (let c = col0; c < col0 + cols; c++) if (!cellFogged(m, c, r)) out.push(`${c},${r}`);
  }
  return out.sort();
};

describe("FR-FOG-05 raster", () => {
  test("FR-FOG-05 raster rect: inclusive, normalised corners", () => {
    expect(listCells({ kind: "rect", c0: 2, r0: 1, c1: 1, r1: 2 })).toEqual(
      ["1,1", "1,2", "2,1", "2,2"].sort(),
    );
    expect(listCells({ kind: "rect", c0: 5, r0: 5, c1: 5, r1: 5 })).toEqual(["5,5"]);
  });

  test("FR-FOG-05 raster triangle: a centre on the diagonal counts (fog-ambush-partial)", () => {
    // [(8, 9), (13, 9), (8, 14)]: the Cave Ogre's (10, 11) centre (10.5, 11.5) lies on x + y = 22.
    const got = listCells(poly([8, 9], [13, 9], [8, 14]));
    expect(got).toContain("10,11");
    expect(got).not.toContain("11,11");
    // Row 9 (centre y 9.5): x from 8 to 12.5 → cells 8…12 (12.5 is cell 12's centre: on the edge).
    expect(got.filter((k) => k.endsWith(",9")).sort()).toEqual(
      ["8,9", "9,9", "10,9", "11,9", "12,9"].sort(),
    );
    expect(got).toHaveLength(15); // 5 + 4 + 3 + 2 + 1
  });

  test("FR-FOG-05 raster square polygon = the same cells as the rect", () => {
    expect(listCells(poly([15, 10], [19, 10], [19, 13], [15, 13]))).toEqual(
      listCells({ kind: "rect", c0: 15, r0: 10, c1: 18, r1: 12 }),
    );
  });

  test("FR-FOG-05 raster concave: the notch stays out", () => {
    // U shape: 0…6 wide, 0…4 high, notch x 2…4 from y 0 to 3.
    const got = listCells(poly([0, 0], [2, 0], [2, 3], [4, 3], [4, 0], [6, 0], [6, 4], [0, 4]));
    expect(got).not.toContain("2,0");
    expect(got).not.toContain("3,2");
    expect(got).toContain("1,0");
    expect(got).toContain("4,0");
    expect(got).toContain("3,3");
    expect(got).toHaveLength(6 * 4 - 2 * 3);
  });

  test("FR-FOG-05 raster crossing / zero area refused", () => {
    expect(
      polygonProblem([
        [0, 0],
        [4, 4],
        [4, 0],
        [0, 4],
      ]),
    ).toBe("crossing"); // bow-tie
    expect(
      polygonProblem([
        [0, 0],
        [2, 0],
        [4, 0],
      ]),
    ).toBe("crossing"); // collinear back-track
    expect(
      polygonProblem([
        [0, 0],
        [4, 0],
        [2, 0],
        [2, 3],
      ]),
    ).toBe("crossing");
    expect(
      polygonProblem([
        [0, 0],
        [3, 0],
        [3, 3],
        [0, 0],
        [0, 3],
      ]),
    ).toBe("crossing"); // repeat
    expect(
      polygonProblem([
        [0, 0],
        [2, 2],
        [4, 4],
      ]),
    ).toBe("crossing");
    // Touching a non-adjacent edge at a vertex is crossing too.
    expect(
      polygonProblem([
        [0, 0],
        [4, 0],
        [4, 4],
        [2, 0],
        [0, 4],
      ]),
    ).toBe("crossing");
    expect(
      polygonProblem([
        [0, 0],
        [4, 0],
        [4, 4],
      ]),
    ).toBeNull();
    expect(
      polygonProblem([
        [0, 0],
        [2, 0],
        [4, 0],
        [4, 4],
      ]),
    ).toBeNull(); // straight-through vertex
  });

  test("FR-FOG-05 raster outside the box ignored; no-op reports no change", () => {
    const m = uniformMask("fog", [0, 0, 4, 4]);
    const out = applyShape(m, "reveal", { kind: "rect", c0: 3, r0: 3, c1: 9, r1: 9 });
    expect(out.changed).toBe(true);
    expect(clearCells(out.mask)).toEqual(["3,3"]);
    expect(cellFogged(out.mask, 5, 5)).toBe(true); // off-box: fill
    expect(applyShape(m, "reveal", { kind: "rect", c0: 10, r0: 10, c1: 12, r1: 12 }).changed).toBe(
      false,
    );
    const again = applyShape(out.mask, "reveal", { kind: "rect", c0: 3, r0: 3, c1: 3, r1: 3 });
    expect(again.changed).toBe(false);
    expect(again.mask).toBe(out.mask);
    // The input mask is never mutated.
    expect(clearCells(m)).toEqual([]);
  });

  test("FR-FOG-05 raster hide over a revealed polygon; box with a negative origin", () => {
    const m = uniformMask("clear", [-1, -1, 6, 6]);
    const hidden = applyShape(m, "hide", poly([-1, -1], [1, -1], [1, 1], [-1, 1])).mask;
    expect(clearCells(m).length - clearCells(hidden).length).toBe(4);
    expect(cellFogged(hidden, -1, -1)).toBe(true);
    expect(cellFogged(hidden, 0, 0)).toBe(true);
    expect(cellFogged(hidden, 1, 1)).toBe(false);
  });
});
