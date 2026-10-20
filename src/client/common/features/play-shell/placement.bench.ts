// FR-SHELL-46 / FR-SHELL-58 perf gates: `placeWindow` for 10 windows × 200 token boxes, best of 5
// ≤ 5 ms (narrowing window ≤ 10 ms). Run alone via `bun run bench`; the placement asserts on the
// same inputs stay in ./placement.test.ts.
import { describe, expect, test } from "bun:test";
import { best, GATE_TIMEOUT } from "@shared/bench-kit";
import { type Placeable, placeWindow } from "./placement";

const vp = { w: 1600, h: 900 };
const windows = Array.from({ length: 10 }, (_, i) => ({
  x: 68 + i * 140,
  y: 60 + (i % 3) * 200,
  w: 120,
  h: 180,
}));
const tokens = Array.from({ length: 200 }, (_, i) => ({
  x: (i * 37) % 1500,
  y: 60 + ((i * 53) % 760),
  w: 48,
  h: 48,
  pc: i % 20 === 0,
}));
/** Sprint 5's inward-column shape (play-shell §12's bound). */
const tall: Placeable = {
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultSize: { w: 300, h: 500 },
  minSize: { w: 300, h: 400 },
};
/** A window that may also narrow (min width < width): searches the columns twice. */
const narrowing: Placeable = {
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultSize: { w: 440, h: 500 },
  minSize: { w: 300, h: 300 },
};

describe("FR-SHELL-46 / FR-SHELL-58 placement", () => {
  test(
    "FR-SHELL-46 FR-SHELL-58 inward column: 10 windows × 200 token boxes best of 5 ≤ 5 ms",
    async () => {
      const ms = await best(() => placeWindow(tall, vp, { windows, tokens }), 5, 5, 3);
      console.log(`FR-SHELL-46 10 windows × 200 boxes: best of 5 ${ms.toFixed(2)} ms`);
      expect(ms).toBeLessThanOrEqual(5);
    },
    GATE_TIMEOUT,
  );

  test(
    "FR-SHELL-58 narrowing window: 10 windows × 200 token boxes best of 5 ≤ 10 ms (twice the budget)",
    async () => {
      const ms = await best(() => placeWindow(narrowing, vp, { windows, tokens }), 10, 5, 3);
      console.log(`FR-SHELL-58 10 windows × 200 boxes, narrowing window: ${ms.toFixed(2)} ms`);
      expect(ms).toBeLessThanOrEqual(10);
    },
    GATE_TIMEOUT,
  );
});
