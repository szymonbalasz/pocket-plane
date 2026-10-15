import { describe, expect, test } from "bun:test";
import {
  cellFogged,
  decodeRuns,
  encodeRuns,
  fogBox,
  footprintFogged,
  maskOf,
  rebase,
  rowOf,
  runCount,
  runsWithinCap,
  sameMask,
  uniformMask,
} from "./mask";
import { FOG_RUNS_MAX } from "./schemas";

const grid = (cellSize: number, offsetX: number, offsetY: number, w: number, h: number) => ({
  gridCellSize: cellSize,
  gridOffsetX: offsetX,
  gridOffsetY: offsetY,
  mapWidth: w,
  mapHeight: h,
});
const cells = (...v: number[]) => Uint8Array.from(v);

describe("FR-FOG-04 codec", () => {
  test("FR-FOG-04 codec round trip: alternating runs from fogged, base 36, comma-separated", () => {
    const c = cells(0, 0, 1, 1, 1, 0, ...new Array(40).fill(1));
    const runs = encodeRuns(c, "clear");
    expect(runs).toBe("0,2,3,1,14"); // 40 = "14" in base 36
    expect(decodeRuns(runs, c.length, "clear")).toEqual(c);
    expect(encodeRuns(cells(1, 1, 0), "fog")).toBe("2,1");
  });

  test('FR-FOG-04 codec "" = every box cell is fill, both ways', () => {
    expect(encodeRuns(cells(1, 1, 1), "fog")).toBe("");
    expect(encodeRuns(cells(0, 0), "clear")).toBe("");
    expect(encodeRuns(cells(1, 1), "clear")).toBe("2");
    expect(decodeRuns("", 3, "fog")).toEqual(cells(1, 1, 1));
    expect(decodeRuns("", 2, "clear")).toEqual(cells(0, 0));
  });

  test("FR-FOG-04 codec bad sum or malformed → null; maskOf fails closed (fully fogged, corrupt)", () => {
    expect(decodeRuns("1,2", 4, "clear")).toBeNull();
    expect(decodeRuns("5", 4, "clear")).toBeNull();
    expect(decodeRuns("1,-1", 4, "clear")).toBeNull();
    expect(decodeRuns("1,,3", 4, "clear")).toBeNull();
    expect(decodeRuns("A", 10, "clear")).toBeNull();
    const { mask, corrupt } = maskOf({ fill: "clear", box: [0, 0, 2, 2], runs: "1,2" });
    expect(corrupt).toBe(true);
    expect(mask.fill).toBe("fog");
    expect([...mask.cells]).toEqual([1, 1, 1, 1]);
    expect(cellFogged(mask, 50, 50)).toBe(true);
  });

  test("FR-FOG-04 codec cap: ≤ 2,000 runs", () => {
    const alt = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : 0));
    expect(runCount(encodeRuns(alt(FOG_RUNS_MAX), "clear"))).toBe(FOG_RUNS_MAX);
    expect(runsWithinCap(encodeRuns(alt(FOG_RUNS_MAX), "clear"))).toBe(true);
    expect(runsWithinCap(encodeRuns(alt(FOG_RUNS_MAX + 1), "clear"))).toBe(false);
    expect(runCount("")).toBe(0);
  });

  test("FR-FOG-01 no row = every cell clear; a row's cell outside the box takes fill", () => {
    const none = maskOf(null);
    expect(none.corrupt).toBe(false);
    expect(cellFogged(none.mask, 3, 4)).toBe(false);
    const { mask } = maskOf({ fill: "fog", box: [0, 0, 2, 1], runs: "0,1,1" });
    expect([cellFogged(mask, 0, 0), cellFogged(mask, 1, 0)]).toEqual([false, true]);
    expect(cellFogged(mask, -1, 0)).toBe(true);
    expect(cellFogged(mask, 0, 1)).toBe(true);
    expect(rowOf(mask)).toEqual({ fill: "fog", box: [0, 0, 2, 1], runs: "0,1,1" });
  });
});

describe("FR-FOG-03 box", () => {
  test("FR-FOG-03 box offset 0: 1400 × 980 at 70 px = 20 × 14 from (0, 0)", () => {
    expect(fogBox(grid(70, 0, 0, 1400, 980))).toEqual([0, 0, 20, 14]);
  });

  test("FR-FOG-03 box offset > 0: a partial cell on each side joins the box", () => {
    // Cell −1 spans x −40…30 (overlaps the map); the last, cell 19, spans 1360…1430.
    expect(fogBox(grid(70, 30, 10, 1400, 980))).toEqual([-1, -1, 21, 15]);
    // Smallest cell on the largest display map → ≤ 513 cells per side.
    const [, , cols, rows] = fogBox(grid(8, 7.5, 7.5, 4096, 4096));
    expect(cols).toBeLessThanOrEqual(513);
    expect(rows).toBeLessThanOrEqual(513);
  });

  test("FR-FOG-03 box re-base to a smaller box: dropped cells fall back to fill and change", () => {
    // fill fog; a clear cell at (3, 0) that leaves the box becomes fogged again.
    const m = {
      fill: "fog" as const,
      box: [0, 0, 4, 1] as [number, number, number, number],
      cells: cells(0, 1, 0, 0),
    };
    const small = rebase(m, [0, 0, 2, 1]);
    expect([...small.cells]).toEqual([0, 1]);
    expect(cellFogged(m, 3, 0)).toBe(false);
    expect(cellFogged(small, 3, 0)).toBe(true);
    // A larger box: new cells take fill; kept cells keep their value.
    const big = rebase(small, [-1, 0, 4, 1]);
    expect([...big.cells]).toEqual([1, 0, 1, 1]);
    expect(sameMask(rebase(m, m.box), m)).toBe(true);
  });
});

describe("FR-FOG-10 fogged", () => {
  const m = maskOf({ fill: "fog", box: [0, 0, 4, 4], runs: "" }).mask;

  test("FR-FOG-10 fogged 1×1 token in fog / in a clear cell", () => {
    expect(footprintFogged(m, { col: 1, row: 1, w: 1, h: 1 })).toBe(true);
    const cleared = { ...m, cells: m.cells.slice() };
    cleared.cells[1 * 4 + 1] = 0;
    expect(footprintFogged(cleared, { col: 1, row: 1, w: 1, h: 1 })).toBe(false);
  });

  test("FR-FOG-10 fogged Large with one clear cell → not fogged", () => {
    const c = { ...m, cells: m.cells.slice() };
    c.cells[2 * 4 + 3] = 0;
    expect(footprintFogged(c, { col: 2, row: 1, w: 2, h: 2 })).toBe(false);
    expect(footprintFogged(c, { col: 0, row: 0, w: 2, h: 2 })).toBe(true);
  });

  test("FR-FOG-10 fogged off-box cells take fill", () => {
    expect(footprintFogged(m, { col: 3, row: 3, w: 2, h: 2 })).toBe(true);
    const clear = uniformMask("clear", [0, 0, 4, 4]);
    clear.cells.fill(1);
    expect(footprintFogged(clear, { col: 3, row: 3, w: 2, h: 2 })).toBe(false);
  });

  test("FR-FOG-10 fogged uncut template cells: a cell list, every one fogged; empty = not", () => {
    expect(
      footprintFogged(m, [
        [0, 0],
        [9, 9],
      ]),
    ).toBe(true);
    const c = { ...m, cells: m.cells.slice() };
    c.cells[0] = 0;
    expect(
      footprintFogged(c, [
        [0, 0],
        [1, 0],
      ]),
    ).toBe(false);
    expect(footprintFogged(m, [])).toBe(false);
  });
});
