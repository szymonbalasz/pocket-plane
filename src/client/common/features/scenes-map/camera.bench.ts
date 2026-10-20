// FR-MAP-59 perf gate: `fitVisible` on the named worst case (scenes-map §12) best of 5 ≤ 25 ms;
// FR-MAP-81: `pcsPan` on its worst bounded case (36 tokens × 6 obstacles at 1280×720), same budget.
// Run alone via `bun run bench`; the fit asserts stay in ./camera.test.ts.
import { describe, expect, test } from "bun:test";
import { best, GATE_TIMEOUT } from "@shared/bench-kit";
import { allClear, fitVisible, pcsPan, visibleArea } from "./camera";

/**
 * 30 tokens spread on a 30 × 20 map (70-px cells): one per column, rows 0–19 all used, so the
 * footprints span every column and row. 6 obstacles: three full-height and three full-width bars
 * cutting the 3000 × 2000 area into gaps of 742.5 × 492.5 px. Step 1 at 100 px; every cell from
 * 100 down to 25 px is blocked (30 cells ≥ 750 px or 20 cells ≥ 500 px cross a bar), 24 px fits:
 * every scale runs (100, 96, …, 28, 24, then 27, 26, 25), each with 180 forbidden rectangles.
 */
function worstCase() {
  const cell = 70;
  const tokens = Array.from({ length: 30 }, (_, i) => ({
    x: i * cell,
    y: Math.floor((i * 19) / 29) * cell,
    w: cell,
    h: cell,
  }));
  const area = { x: 84, y: 64, w: 3000, h: 2000 };
  const gx = (area.w - 30) / 4;
  const gy = (area.h - 30) / 4;
  const obstacles = [1, 2, 3].flatMap((k) => [
    { x: area.x + k * gx + (k - 1) * 10, y: area.y, w: 10, h: area.h },
    { x: area.x, y: area.y + k * gy + (k - 1) * 10, w: area.w, h: 10 },
  ]);
  const from = { x: area.x, y: area.y, scale: 100 / cell };
  return { tokens, obstacles, area, from, cell };
}

describe("FR-MAP-59 helper", () => {
  test(
    "FR-MAP-59 perf: fitVisible on the worst case (30 tokens, 6 obstacles, 100 → 24 px) best of 5 ≤ 25 ms",
    async () => {
      const { tokens, obstacles, area, from, cell } = worstCase();
      const r = fitVisible(tokens, obstacles, area, from, cell);
      expect(r.visible).toBe("all");
      expect(Math.round(r.scale * cell)).toBe(24);
      expect(allClear(r, tokens, obstacles, area)).toBe(true);
      const ms = await best(() => fitVisible(tokens, obstacles, area, from, cell), 25, 5, 1);
      console.log(`FR-MAP-59 fitVisible worst case: best of 5 ${ms.toFixed(2)} ms`);
      expect(ms).toBeLessThanOrEqual(25);
    },
    GATE_TIMEOUT,
  );
});

/**
 * FR-MAP-81's worst bounded case at 1280×720: 6 PCs in a 2 × 3 block (a wide pan range), 30 more
 * tokens on a 6 × 5 lattice around them (every edge inside the range), 6 windows in the area.
 */
function worstPcsCase() {
  const cell = 70;
  const view = { w: 1280, h: 720 };
  const pcs = Array.from({ length: 6 }, (_, i) => ({
    x: (9 + (i % 3)) * cell,
    y: (6 + Math.floor(i / 3)) * cell,
    w: cell,
    h: cell,
    pc: true,
  }));
  const others = Array.from({ length: 30 }, (_, i) => ({
    x: (2 + (i % 6) * 3 + (Math.floor(i / 6) % 2)) * cell,
    y: (1 + Math.floor(i / 6) * 3) * cell,
    w: cell,
    h: cell,
    pc: false,
  }));
  const obstacles = [
    { x: 68, y: 484, w: 690, h: 160 },
    { x: 868, y: 60, w: 400, h: 500 },
    { x: 480, y: 100, w: 320, h: 57 },
    { x: 68, y: 60, w: 260, h: 300 },
    { x: 560, y: 300, w: 200, h: 120 },
    { x: 360, y: 200, w: 120, h: 80 },
  ];
  return { tokens: [...others, ...pcs], obstacles, view, area: visibleArea(view), cell };
}

describe("FR-MAP-81 helper", () => {
  test(
    "FR-MAP-81 perf: pcsPan on the worst bounded case (36 tokens, 6 obstacles, 1280×720) best of 5 ≤ 25 ms",
    async () => {
      const { tokens, obstacles, view, area, cell } = worstPcsCase();
      const from = { x: 100, y: 0 };
      const r = pcsPan(tokens, obstacles, area, view, from, cell);
      expect(r).not.toBeNull();
      const ms = await best(() => pcsPan(tokens, obstacles, area, view, from, cell), 25, 5, 1);
      console.log(`FR-MAP-81 pcsPan worst bounded case: best of 5 ${ms.toFixed(2)} ms`);
      expect(ms).toBeLessThanOrEqual(25);
    },
    GATE_TIMEOUT,
  );
});
