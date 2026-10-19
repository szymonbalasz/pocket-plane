// Scenes and timing for the FOG §12 vision benchmarks. The ms gates (`*.bench.ts`) run only via
// `bun run bench`, alone, so parallel suites can't skew them (BL-32); the size gates on the same
// scenes stay in `bun test` (`vision-sizes.test.ts`).
// V0 scenes: caps = the true caps: 2,000 segments all within r = 24 cells of every source, 100
// fog + 20 darkness shapes, 200 tokens of 16 cells each, 6 players × 4 sources. Typical = 150
// walls, 12 fog shapes, 2 darkness shapes, PCs vision 30 ft / darkvision 60 ft. caps-rooms: the
// same caps with the 2,000 segments as a room grid.
// Sprint-4 scene (r 199.8): 2,000 random walls on a 120 × 120 map + its edges, 100 fog + 20
// darkness shapes, 200 tokens of 16 cells, 6 players × 4 sources each at its own origin (12 count
// with party vision on, FR-FOG-52).
import { type FogMask, uniformMask } from "./mask";
import type { FogShapeOp, ShapeLike } from "./shapes";
import {
  NORMAL_SENSES,
  type PlayerVision,
  pointVisible,
  polygonCells,
  prepareScene,
  prepareStaticLayer,
  type SamplePoint,
  type Seg,
  type Senses,
  samplePoint,
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

export const PATIENCE_MS = 15_000;
/** Test timeout for a timed gate: the N runs plus the patience window, with room under load. */
export const GATE_TIMEOUT = 60_000;

/**
 * Fastest ms of `runs` timed calls after `warm` untimed ones. Best of N, not the median: load
 * only adds time, so the minimum is the load-tolerant cost estimate (BL-28). While the fastest
 * is still over `budget`, keep sampling, one run per 200 ms (few, spread out), for up to
 * PATIENCE_MS: a burst of load longer than the N runs then passes, a real regression still fails.
 */
export async function best(fn: () => void, budget: number, runs = 15, warm = 3): Promise<number> {
  for (let i = 0; i < warm; i++) fn();
  const time = () => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  };
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) min = Math.min(min, time());
  const deadline = performance.now() + PATIENCE_MS;
  while (min > budget && performance.now() < deadline) {
    await Bun.sleep(200);
    min = Math.min(min, time());
  }
  return min;
}

/** Logs a benchmark's numbers for the build report. */
export function logResults(title: string, results: Record<string, number>): void {
  console.log(
    `${title}:\n${Object.entries(results)
      .map(([k, v]) => `  ${k}: ${Number.isInteger(v) ? v : v.toFixed(2)}`)
      .join("\n")}`,
  );
}

// ---- V0 scenes ----

const CX = 60;
const CY = 60;

export interface Scene {
  walls: Seg[];
  shapes: (ShapeLike & { op: FogShapeOp })[];
  darkness: ShapeLike[];
  /** Per player: their sources. */
  players: VisionSource[][];
  /** Token footprints: top-left + side (cells). */
  tokens: { col: number; row: number; n: number }[];
  mask: FogMask;
}

export type Kind = "typical" | "caps" | "caps-rooms";

/** V0 scene kinds with their ms caps: one polygon, a move, a full-scene re-derive. */
export const V0_KINDS = [
  ["typical", 2, 10, 20],
  ["caps", 10, 30, 60],
  ["caps-rooms", 10, 30, 60],
] as const;

/**
 * caps-rooms: 2,000 wall pieces of a 2-cell room grid with a doorway gap in every side, all
 * within 24 cells of the centre: sight runs far down the doorway lines, so most pieces stay in
 * the sweep (the two-pass cull helps least).
 */
function roomWalls(): Seg[] {
  const out: Seg[] = [];
  for (let k = -24; k <= 24 && out.length < 2000; k += 2) {
    for (let j = -24; j < 24 && out.length < 2000; j += 2) {
      const pieces: Seg[] = [
        [CX + k, CY + j, CX + k, CY + j + 0.75],
        [CX + k, CY + j + 1.25, CX + k, CY + j + 2],
        [CX + j, CY + k, CX + j + 0.75, CY + k],
        [CX + j + 1.25, CY + k, CX + j + 2, CY + k],
      ];
      for (const w of pieces) {
        const mx = (w[0] + w[2]) / 2 - CX;
        const my = (w[1] + w[3]) / 2 - CY;
        if (Math.hypot(mx, my) <= 23 && out.length < 2000) out.push(w);
      }
    }
  }
  return out;
}

export function buildScene(kind: Kind): Scene {
  const rand = rng(kind === "typical" ? 2 : 1);
  const caps = kind !== "typical";
  // Walls: caps = 2,000 short freeform segments, every one within 24 cells of the centre
  // (so of every source); typical = 150 room walls on a 40 × 30 map.
  const walls: Seg[] = kind === "caps-rooms" ? roomWalls() : [];
  const nWalls = kind === "caps-rooms" ? 0 : caps ? 2000 : 150;
  for (let i = 0; i < nWalls; i++) {
    let x: number;
    let y: number;
    if (caps) {
      const a = rand() * 2 * Math.PI;
      const d = 2 + rand() * 20;
      x = CX + d * Math.cos(a);
      y = CY + d * Math.sin(a);
    } else {
      x = CX - 20 + rand() * 40;
      y = CY - 15 + rand() * 30;
    }
    const a = rand() * 2 * Math.PI;
    const len = caps ? 0.5 + rand() * 1.5 : 1 + rand() * 4;
    walls.push([r2(x), r2(y), r2(x + len * Math.cos(a)), r2(y + len * Math.sin(a))]);
  }
  const shapes: Scene["shapes"] = [];
  const ops: FogShapeOp[] = ["reveal", "fog", "explored"];
  const nShapes = caps ? 100 : 12;
  for (let i = 0; i < nShapes; i++) {
    const x = CX - 25 + rand() * 50;
    const y = CY - 25 + rand() * 50;
    const op = ops[i % 3] as FogShapeOp;
    if (i % 3 === 0)
      shapes.push({ op, rect: [r2(x), r2(y), r2(x + 2 + rand() * 8), r2(y + 2 + rand() * 8)] });
    else if (i % 3 === 1) {
      const n = caps ? 64 : 10;
      const poly: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n;
        const rr = 2 + rand() * 3;
        poly.push(r2(x + rr * Math.cos(a)), r2(y + rr * Math.sin(a)));
      }
      shapes.push({ op, polygon: poly });
    } else shapes.push({ op, circle: [r2(x), r2(y), r2(1 + rand() * 4)] });
  }
  const darkness: ShapeLike[] = [];
  for (let i = 0; i < (caps ? 20 : 2); i++) {
    darkness.push({
      circle: [r2(CX - 20 + rand() * 40), r2(CY - 20 + rand() * 40), r2(1 + rand() * 2)],
    });
  }
  const pc: Senses = {
    visionFt: caps ? 120 : 30,
    darkvisionFt: caps ? 120 : 60,
    seesMagicalDarkness: false,
  };
  const devil: Senses = { ...pc, seesMagicalDarkness: true, seesInvisible: true };
  const players: VisionSource[][] = [];
  for (let p = 0; p < 6; p++) {
    const srcs: VisionSource[] = [];
    for (let s = 0; s < (caps ? 4 : 1); s++) {
      srcs.push({
        x: Math.floor(CX - 3 + rand() * 6) + 0.5,
        y: Math.floor(CY - 3 + rand() * 6) + 0.5,
        senses: s === 0 && p % 2 === 0 ? devil : pc,
      });
    }
    players.push(srcs);
  }
  const tokens: Scene["tokens"] = [];
  for (let i = 0; i < (caps ? 200 : 60); i++) {
    tokens.push({
      col: Math.floor(CX - 24 + rand() * 46),
      row: Math.floor(CY - 24 + rand() * 46),
      n: caps ? 4 : 1,
    });
  }
  return { walls, shapes, darkness, players, tokens, mask: uniformMask("fog", [0, 0, 120, 120]) };
}

/** Every token footprint cell centre, with its static state (computed once per re-derive). */
export function samples(s: Scene): SamplePoint[] {
  const layer = prepareStaticLayer(s.mask, s.shapes, s.darkness);
  const out: SamplePoint[] = [];
  for (const t of s.tokens)
    for (let r = t.row; r < t.row + t.n; r++)
      for (let c = t.col; c < t.col + t.n; c++) out.push(samplePoint(layer, c + 0.5, r + 0.5));
  return out;
}

export function visibleCount(v: PlayerVision, pts: readonly SamplePoint[]): number {
  let n = 0;
  for (const p of pts) if (pointVisible(v, p)) n++;
  return n;
}

export function exploredCells(v: PlayerVision): number {
  const cells = new Set<number>();
  for (const p of v.polys) polygonCells(p.poly, (c, r) => cells.add(r * 4096 + c));
  return cells.size;
}

// ---- Sprint-4 scene (r 199.8) ----

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

/** The sprint-4 caps scene, prepared: occluders, every token sample, the 12 counted sources. */
export function sprint4Scene() {
  const s = buildCaps(4);
  const scene = prepareScene(s.walls, s.darkness, BOUNDS);
  const layer = prepareStaticLayer(s.mask, s.shapes, s.darkness);
  const samples: SamplePoint[] = [];
  for (const t of s.tokens)
    for (let r = t.row; r < t.row + 4; r++)
      for (let c = t.col; c < t.col + 4; c++) samples.push(samplePoint(layer, c + 0.5, r + 0.5));
  // Party vision on: 12 sources, 2 per player in round robin (FR-FOG-52).
  const counted = s.players.map((srcs) => srcs.slice(0, 2));
  return { players: s.players, scene, samples, counted };
}
