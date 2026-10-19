// FOG §12 sprint-4 benchmark = the V core exit gate re-run at r 199.8 (FOG §12 "V core
// benchmark"): Normal 999 ft sources, map edges, inward simplification. Caps = 2,000 random walls
// on a 120 × 120 map + its edges, 100 fog + 20 darkness shapes, 200 tokens of 16 cells, 6 players
// × 4 sources each at its own origin (12 count with party vision on, FR-FOG-52). Targets: one
// polygon ≤ 10 ms; a move with party vision on at 12 sources ≤ 30 ms (the mover's sight + every
// token sample against the party's polygons + memory from the mover's polygons only; the others'
// sight is cached with its containment grids, as the server's vision cache keeps them); the switch
// (every counted source + samples + memory) ≤ 150 ms; one player's `vision` at 4 sources ≤ 48 KiB.
// Best of N after warm-up; numbers logged for the build report.
import { describe, expect, test } from "bun:test";
import { type FogMask, uniformMask } from "./mask";
import type { FogShapeOp, ShapeLike } from "./shapes";
import {
  NORMAL_SENSES,
  type PlayerVision,
  partyVision,
  playerVision,
  pointVisible,
  polygonCells,
  prepareScene,
  prepareStaticLayer,
  type SamplePoint,
  type Seg,
  samplePoint,
  sourcePolygons,
  type VisionSource,
} from "./vision";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r2 = (v: number) => Math.round(v * 100) / 100;

// Best of N, not the median: load from parallel suites only adds time, so the fastest run is the
// load-tolerant estimate of the code's own cost and a real regression still lifts it (BL-28).
function best(fn: () => void, runs = 9, warm = 2): number {
  for (let i = 0; i < warm; i++) fn();
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    min = Math.min(min, performance.now() - t0);
  }
  return min;
}

const SIZE = 120;
const BOUNDS = [0, 0, SIZE, SIZE] as const;

function buildCaps(seed: number) {
  const rand = rng(seed);
  const walls: Seg[] = [];
  for (let i = 0; i < 2000; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const a = rand() * 2 * Math.PI;
    const len = 0.5 + rand() * 1.5;
    walls.push([r2(x), r2(y), r2(x + len * Math.cos(a)), r2(y + len * Math.sin(a))]);
  }
  const shapes: (ShapeLike & { op: FogShapeOp })[] = [];
  const ops: FogShapeOp[] = ["reveal", "fog", "explored"];
  for (let i = 0; i < 100; i++) {
    const x = rand() * (SIZE - 10);
    const y = rand() * (SIZE - 10);
    shapes.push({ op: ops[i % 3] as FogShapeOp, rect: [r2(x), r2(y), r2(x + 4), r2(y + 4)] });
  }
  const darkness: ShapeLike[] = [];
  for (let i = 0; i < 20; i++) {
    darkness.push({ circle: [r2(rand() * SIZE), r2(rand() * SIZE), r2(1 + rand() * 2)] });
  }
  const players: VisionSource[][] = [];
  for (let p = 0; p < 6; p++) {
    const srcs: VisionSource[] = [];
    for (let s = 0; s < 4; s++) {
      srcs.push({
        x: Math.floor(10 + rand() * (SIZE - 20)) + 0.5,
        y: Math.floor(10 + rand() * (SIZE - 20)) + 0.5,
        senses: { ...NORMAL_SENSES, darkvisionFt: 60, seesMagicalDarkness: s === 0 },
        id: `t${p}-${s}`,
      });
    }
    players.push(srcs);
  }
  const tokens: { col: number; row: number }[] = [];
  for (let i = 0; i < 200; i++) {
    tokens.push({ col: Math.floor(rand() * (SIZE - 4)), row: Math.floor(rand() * (SIZE - 4)) });
  }
  const mask: FogMask = uniformMask("fog", [0, 0, SIZE, SIZE]);
  return { walls, shapes, darkness, players, tokens, mask };
}

const results: Record<string, number> = {};

describe("FOG §12 sprint-4 benchmark (V core exit gate at r 199.8)", () => {
  const s = buildCaps(4);
  const scene = prepareScene(s.walls, s.darkness, BOUNDS);
  const layer = prepareStaticLayer(s.mask, s.shapes, s.darkness);
  const samples: SamplePoint[] = [];
  for (const t of s.tokens)
    for (let r = t.row; r < t.row + 4; r++)
      for (let c = t.col; c < t.col + 4; c++) samples.push(samplePoint(layer, c + 0.5, r + 0.5));
  // Party vision on: 12 sources, 2 per player in round robin (FR-FOG-52).
  const counted = s.players.map((srcs) => srcs.slice(0, 2));
  const cells = (polys: readonly number[][]) => {
    const out = new Set<number>();
    for (const p of polys) polygonCells(p, (c, r) => out.add(r * 4096 + c));
    return out.size;
  };

  test("FR-FOG-33 sprint 4: one polygon at r 199.8 + map edges + simplification ≤ 10 ms", () => {
    const src = s.players[0]?.[1] as VisionSource;
    const ms = best(() => {
      sourcePolygons(scene, src);
    }, 31);
    const [see] = sourcePolygons(scene, src);
    results["polygon ms"] = ms;
    results["polygon vertices"] = (see?.length ?? 0) / 2;
    expect(ms).toBeLessThanOrEqual(10);
  });

  test("FR-FOG-50 / -52 a move with party vision on at 12 sources ≤ 30 ms", () => {
    // The others' sight, cached (containment grids built once, as in the vision cache).
    const others: PlayerVision[] = counted.slice(1).map((srcs) => playerVision(scene, srcs));
    const warmParty = partyVision(others) as PlayerVision;
    for (const pt of samples) pointVisible(warmParty, pt);
    let k = 0;
    const ms = best(() => {
      const moved = (counted[0] as VisionSource[]).map((src) => ({ ...src, x: src.x + (k++ % 2) }));
      const mine = playerVision(scene, moved);
      const party = partyVision([mine, ...others]) as PlayerVision;
      let seen = 0;
      for (const pt of samples) if (pointVisible(party, pt)) seen++;
      cells(mine.see);
      results["move samples seen"] = seen;
    });
    results["move (party, 12 sources) ms"] = ms;
    expect(ms).toBeLessThanOrEqual(30);
  });

  test("FR-FOG-49 the switch (every counted source + samples + memory) ≤ 150 ms", () => {
    const ms = best(
      () => {
        const visions = counted.map((srcs) => playerVision(scene, srcs));
        const party = partyVision(visions) as PlayerVision;
        for (const pt of samples) pointVisible(party, pt);
        cells(visions.flatMap((v) => v.see));
      },
      5,
      1,
    );
    results["switch ms"] = ms;
    expect(ms).toBeLessThanOrEqual(150);
  });

  test("FR-FOG-39 one player's `vision` at 4 sources (caps) ≤ 48 KiB; 12 shared records measured", () => {
    let own = 0;
    let all = 0;
    for (const [i, srcs] of s.players.entries()) {
      const v = playerVision(scene, srcs);
      const rec = {
        id: "scene-0123456789-0123456789-0123:player-0123456789-0123456789-01",
        sceneId: "scene-0123456789-0123456789-0123",
        playerId: "player-0123456789-0123456789-01",
        blind: v.blind,
        see: v.see,
        dark: v.dark,
        src: v.src,
      };
      const bytes = Buffer.byteLength(JSON.stringify(rec), "utf8");
      own = Math.max(own, bytes);
      const c = playerVision(scene, counted[i] as VisionSource[]);
      all += Buffer.byteLength(JSON.stringify({ ...rec, see: c.see, dark: c.dark, src: c.src }));
    }
    results["own vision at 4 sources max B"] = own;
    results["shared vision, 12 sources total B"] = all;
    expect(own).toBeLessThanOrEqual(48 * 1024);
    expect(all).toBeLessThanOrEqual(192 * 1024);
  });

  test("FOG §12 sprint-4 benchmark numbers (logged)", () => {
    console.log(
      `FOG §12 sprint-4 benchmark (r 199.8):\n${Object.entries(results)
        .map(([k, v]) => `  ${k}: ${Number.isInteger(v) ? v : v.toFixed(2)}`)
        .join("\n")}`,
    );
    expect(Object.keys(results).length).toBeGreaterThan(0);
  });
});
