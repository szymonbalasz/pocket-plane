// FR-MAP-52 (OQ-MAP-36): the drag path = the straight line start → target, one cell per step;
// its steps' cost = the drag's distance under either diagonal rule.
import { describe, expect, test } from "bun:test";
import { distanceFt } from "@shared/scene-tools/geometry";
import type { DiagonalRule } from "@shared/scene-tools/schemas";
import { dragPath } from "./geometry";

type Cell = { col: number; row: number };
const s = (cells: Cell[]) => cells.map((c) => `${c.col},${c.row}`).join(" ");

/** The steps' cost: 5 a step; under 5/10/5 every second diagonal costs 10. */
function stepsCost(path: Cell[], rule: DiagonalRule): number {
  let ft = 0;
  let diagonals = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Cell;
    const b = path[i] as Cell;
    const diagonal = a.col !== b.col && a.row !== b.row;
    if (diagonal) diagonals += 1;
    ft += rule === "5-10-5" && diagonal && diagonals % 2 === 0 ? 10 : 5;
  }
  return ft;
}

/** Deterministic LCG (no Math.random in tests that pin numbers). */
function lcg(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

describe("FR-MAP-52 dragPath", () => {
  test("FR-MAP-52 dragPath straight east / south / diagonal / knight-move; no move = one cell", () => {
    expect(s(dragPath({ col: 2, row: 7 }, { col: 5, row: 7 }))).toBe("2,7 3,7 4,7 5,7");
    expect(s(dragPath({ col: 2, row: 7 }, { col: 2, row: 4 }))).toBe("2,7 2,6 2,5 2,4");
    expect(s(dragPath({ col: 0, row: 0 }, { col: 3, row: 3 }))).toBe("0,0 1,1 2,2 3,3");
    expect(s(dragPath({ col: 3, row: 3 }, { col: 0, row: 6 }))).toBe("3,3 2,4 1,5 0,6");
    // Knight move: the half-way tie goes toward the target's row.
    expect(s(dragPath({ col: 0, row: 0 }, { col: 2, row: 1 }))).toBe("0,0 1,1 2,1");
    expect(s(dragPath({ col: 2, row: 1 }, { col: 0, row: 0 }))).toBe("2,1 1,0 0,0");
    expect(s(dragPath({ col: 0, row: 0 }, { col: 1, row: -2 }))).toBe("0,0 1,-1 1,-2");
    expect(s(dragPath({ col: 4, row: 4 }, { col: 4, row: 4 }))).toBe("4,4");
  });

  test("FR-MAP-52 dragPath Mira (2, 7) → (5, 8) = (2, 7) (3, 7) (4, 8) (5, 8), 15 ft", () => {
    const p = dragPath({ col: 2, row: 7 }, { col: 5, row: 8 });
    expect(s(p)).toBe("2,7 3,7 4,8 5,8");
    expect(stepsCost(p, "5-10-5")).toBe(15);
  });

  test("FR-MAP-52 dragPath Large footprint: the path is the top-left's (same cells as a 1×1)", () => {
    // The footprint is drawn per step by the client; the stepping itself ignores the size.
    expect(s(dragPath({ col: 4, row: 10 }, { col: 7, row: 12 }))).toBe("4,10 5,11 6,11 7,12");
  });

  test("FR-MAP-52 dragPath ties toward the target, step count max + 1, one cell per step", () => {
    // (0, 0) → (4, 2): rows 0, 0.5, 1, 1.5, 2 → the halves go down (toward row 2).
    expect(s(dragPath({ col: 0, row: 0 }, { col: 4, row: 2 }))).toBe("0,0 1,1 2,1 3,2 4,2");
    // Reversed, the halves go up (toward row 0).
    expect(s(dragPath({ col: 4, row: 2 }, { col: 0, row: 0 }))).toBe("4,2 3,1 2,1 1,0 0,0");
    // Column ties when rows are the longer axis.
    expect(s(dragPath({ col: 0, row: 0 }, { col: 1, row: 2 }))).toBe("0,0 1,1 1,2");
    expect(s(dragPath({ col: 1, row: 2 }, { col: 0, row: 0 }))).toBe("1,2 0,1 0,0");
  });

  test("FR-MAP-52 dragPath 5/10/5 cost of the steps = distanceFt for 10k seeded pairs under both rules", () => {
    const rnd = lcg(52);
    const pick = () => Math.floor(rnd() * 41) - 20;
    for (let i = 0; i < 10_000; i++) {
      const from = { col: pick(), row: pick() };
      const to = { col: pick(), row: pick() };
      const p = dragPath(from, to);
      const dx = Math.abs(to.col - from.col);
      const dy = Math.abs(to.row - from.row);
      expect(p.length).toBe(Math.max(dx, dy) + 1);
      expect(p[0]).toEqual(from);
      expect(p.at(-1)).toEqual(to);
      let diagonals = 0;
      for (let k = 1; k < p.length; k++) {
        const a = p[k - 1] as Cell;
        const b = p[k] as Cell;
        const stepC = Math.abs(b.col - a.col);
        const stepR = Math.abs(b.row - a.row);
        expect(Math.max(stepC, stepR)).toBe(1);
        if (stepC === 1 && stepR === 1) diagonals += 1;
      }
      expect(diagonals).toBe(Math.min(dx, dy));
      for (const rule of ["5-10-5", "5"] as const)
        expect(stepsCost(p, rule)).toBe(distanceFt(from, to, rule));
    }
  });
});
