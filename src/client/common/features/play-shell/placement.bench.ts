// FR-SHELL-46 / FR-SHELL-58 perf gates: `placeWindow` for 10 windows × 200 token boxes, best of 5
// ≤ 5 ms (narrowing window ≤ 10 ms); FR-SHELL-77: a whole auto placement ≤ 25 ms, worst ≤ 100 ms;
// FR-SHELL-119: one `settle` with a dry fit ≤ 25 ms, 40 windows ≤ 100 ms. Run alone via `bun run
// bench`; the placement asserts on the same inputs stay in ./placement.test.ts.
import { describe, expect, test } from "bun:test";
import { best, GATE_TIMEOUT } from "@shared/bench-kit";
import type { WindowState } from "@shared/play-shell/layout";
import { fitScene } from "../scenes-map/camera";
import { freeAreas } from "./free-area";
import { defaultLayout, type ManagerContext, plan, reduce } from "./manager";
import { type Placeable, type PlacementToken, placeStats, placeWindow } from "./placement";
import { createWindowRegistry, type WindowDef } from "./registry";

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

// FR-SHELL-77 perf gates (FU1): a whole auto placement (`reduce` open: look-ahead, auto-minimise
// loop, shrink, least-PC sweep) with 12 windows open ≤ 25 ms; the worst case, every one of the
// 39 other launcher windows auto-minimised in turn (the loop's bound: FR-SHELL-17's 40 windows),
// ≤ 100 ms.
const Body = () => null;
const launcher = (kind: string): WindowDef => ({
  kind,
  title: kind,
  clients: ["dm"],
  defaultSize: { w: 440, h: 400 },
  minSize: { w: 320, h: 240 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  component: Body,
});
const kindsOf = (n: number) => Array.from({ length: n }, (_, i) => `b.w${i}`);
const registryOf = (n: number) =>
  createWindowRegistry("dm", [
    {
      ...launcher("b.log"),
      defaultOpen: true,
      defaultSize: { w: 1150, h: 240 },
      minSize: { w: 300, h: 160 },
      defaultPosition: { anchor: "bottom-left", dx: 56 },
    },
    ...kindsOf(n).map(launcher),
  ]);
/** `n` launcher windows open on `at(i)`, the log at its default; z in order. */
function layout(n: number, at: (i: number) => { x: number; y: number }): WindowState[] {
  const reg = registryOf(n);
  const base = defaultLayout(reg, vp);
  return [
    ...base,
    ...kindsOf(n - 1).map((kind, i) => ({
      kind,
      instance: "main",
      state: "open" as const,
      ...at(i),
      w: 440,
      h: 400,
      z: base.length + i + 1,
    })),
  ];
}

describe("FR-SHELL-77 auto placement", () => {
  test(
    "FR-SHELL-77 12 windows open, 200 token boxes: one auto placement best of 5 ≤ 25 ms",
    async () => {
      const reg = registryOf(13);
      const ws = layout(13, (i) => ({ x: 68 + (i % 4) * 380, y: 60 + Math.floor(i / 4) * 160 }));
      const ctx: ManagerContext = {
        registry: reg,
        viewport: vp,
        available: new Set(reg.defs.map((d) => d.kind)),
        avoid: () => tokens,
      };
      const ms = await best(() => reduce(ws, { type: "open", kind: "b.w12" }, ctx), 25, 5, 3);
      console.log(`FR-SHELL-77 12 windows × 200 boxes: best of 5 ${ms.toFixed(2)} ms`);
      expect(ms).toBeLessThanOrEqual(25);
    },
    GATE_TIMEOUT,
  );

  test(
    "FR-SHELL-77 worst case: 39 launcher windows stacked on the only PC-free spot, every one auto-minimised in turn, best of 5 ≤ 100 ms",
    async () => {
      const n = 40;
      const reg = registryOf(n);
      const ws = layout(n, () => ({ x: 68, y: 60 }));
      // PCs on every other spot of the usable area.
      const pcs: PlacementToken[] = [];
      for (let x = 560; x < 1560; x += 90)
        for (let y = 70; y < 820; y += 90) pcs.push({ x, y, w: 40, h: 40, pc: true });
      const ctx: ManagerContext = {
        registry: reg,
        viewport: vp,
        available: new Set(reg.defs.map((d) => d.kind)),
        avoid: () => pcs,
      };
      const last = `b.w${n - 1}`;
      const out = reduce(ws, { type: "open", kind: last }, ctx);
      expect(out.filter((w) => w.state === "minimised").length).toBe(n - 1);
      const ms = await best(() => reduce(ws, { type: "open", kind: last }, ctx), 100, 5, 2);
      console.log(`FR-SHELL-77 worst case (39 auto-minimised): best of 5 ${ms.toFixed(2)} ms`);
      expect(ms).toBeLessThanOrEqual(100);
    },
    GATE_TIMEOUT,
  );
});

// FR-SHELL-119 perf gates (WF1), FR-SHELL-158 (BL-82: ≤ 25 ms inside the full `bun run bench`,
// same world: 12 untouched windows; the profile printed first): one settle (`plan` → `settle`) through the whole ladder (L1–L5, the look-ahead,
// put-aways, the protected squeeze) and one dry fit of the base port (L2b, the real `fitScene` on
// 20 tokens), 12 windows × 200 token boxes best of 5 ≤ 25 ms; 40 windows ≤ 100 ms.
const fitTokens = Array.from({ length: 20 }, (_, i) => ({
  col: (i * 3) % 20,
  row: (i * 7) % 14,
  size: "medium" as const,
  pc: i % 5 === 0,
}));
const dryFit = (obstacles: readonly { x: number; y: number; w: number; h: number }[]) => {
  const room = {
    areas: freeAreas(obstacles, vp),
    obstacles,
    windowsOnly: freeAreas(obstacles, vp),
  };
  const grid = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
  const f = fitScene(fitTokens, grid, { w: 1400, h: 980 }, vp, room);
  return { cellPx: f.scale * 70, clear: f.visible === "all" };
};
const playerRegistryOf = (n: number) =>
  createWindowRegistry(
    "player",
    registryOf(n).defs.map((d) => ({ ...d, clients: ["player" as const] })),
  );

describe("FR-SHELL-119 settle", () => {
  for (const [n, budget] of [
    [13, 25],
    [40, 100],
  ] as const) {
    test(
      `FR-SHELL-119 settle: ${n - 1} launcher windows × 200 token boxes, the full ladder + one dry fit, best of 5 ≤ ${budget} ms`,
      async () => {
        const reg = playerRegistryOf(n);
        const ws = layout(n, (i) => ({ x: 68 + (i % 4) * 380, y: 60 + Math.floor(i / 4) * 160 }));
        const ctx: ManagerContext = {
          registry: reg,
          viewport: vp,
          available: new Set(reg.defs.map((d) => d.kind)),
          avoid: () => tokens,
          camera: () => "fitted",
          lastFullCell: () => 40,
          dryFit,
        };
        const kind = `b.w${n - 1}`;
        // FR-SHELL-158: the profile first: searches per settle, token grids built, one search.
        placeStats.searches = 0;
        placeStats.grids = 0;
        const p = plan(ws, { type: "open", kind }, ctx);
        const { searches, grids } = placeStats;
        const one = await best(
          () => placeWindow(launcher(kind), vp, { windows: ws, tokens }),
          99,
          5,
          3,
        );
        console.log(
          `FR-SHELL-158 profile, ${n - 1} windows: ${searches} searches (${grids} token grids, ${searches - grids} reused), ${p.putAway.size} put away, one search ${one.toFixed(2)} ms`,
        );
        const ms = await best(() => plan(ws, { type: "open", kind }, ctx), budget, 5, 3);
        console.log(
          `FR-SHELL-119 settle, ${n - 1} windows × 200 boxes: best of 5 ${ms.toFixed(2)} ms`,
        );
        expect(ms).toBeLessThanOrEqual(budget);
      },
      GATE_TIMEOUT,
    );
  }
});
