// FOG §12 V0 benchmark = the V0 exit gate (FOG §12 "Target" table). Medians after warm-up; the
// numbers are logged for the build report. Caps = the true caps: 2,000 segments all within
// r = 24 cells of every source, 100 fog + 20 darkness shapes, 200 tokens of 16 cells each,
// 6 players × 4 sources. Typical = 150 walls, 12 fog shapes, 2 darkness shapes, PCs vision 30 ft /
// darkvision 60 ft. caps-rooms: the same caps with the 2,000 segments as a room grid.
import { describe, expect, test } from "bun:test";
import { type FogMask, uniformMask } from "./mask";
import type { FogShapeOp, ShapeLike } from "./shapes";
import {
  type PlayerVision,
  playerVision,
  pointVisible,
  polygonCells,
  prepareOccluders,
  prepareScene,
  prepareStaticLayer,
  type SamplePoint,
  type Seg,
  type Senses,
  samplePoint,
  sightPolygon,
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

/** Median ms of `runs` timed calls after `warm` untimed ones. */
function median(fn: () => void, runs = 15, warm = 3): number {
  for (let i = 0; i < warm; i++) fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)] as number;
}

const CX = 60;
const CY = 60;

interface Scene {
  walls: Seg[];
  shapes: (ShapeLike & { op: FogShapeOp })[];
  darkness: ShapeLike[];
  /** Per player: their sources. */
  players: VisionSource[][];
  /** Token footprints: top-left + side (cells). */
  tokens: { col: number; row: number; n: number }[];
  mask: FogMask;
}

type Kind = "typical" | "caps" | "caps-rooms";

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

function buildScene(kind: Kind, seed: number): Scene {
  const rand = rng(seed);
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
function samples(s: Scene): SamplePoint[] {
  const layer = prepareStaticLayer(s.mask, s.shapes, s.darkness);
  const out: SamplePoint[] = [];
  for (const t of s.tokens)
    for (let r = t.row; r < t.row + t.n; r++)
      for (let c = t.col; c < t.col + t.n; c++) out.push(samplePoint(layer, c + 0.5, r + 0.5));
  return out;
}

function visibleCount(v: PlayerVision, pts: readonly SamplePoint[]): number {
  let n = 0;
  for (const p of pts) if (pointVisible(v, p)) n++;
  return n;
}

function exploredCells(v: PlayerVision): number {
  const cells = new Set<number>();
  for (const p of v.polys) polygonCells(p.poly, (c, r) => cells.add(r * 4096 + c));
  return cells.size;
}

const results: Record<string, number> = {};

describe("FOG §12 V0 benchmark (exit gate)", () => {
  for (const [kind, polyMs, moveMs, fullMs] of [
    ["typical", 2, 10, 20],
    ["caps", 10, 30, 60],
    ["caps-rooms", 10, 30, 60],
  ] as const) {
    const s = buildScene(kind, kind === "typical" ? 2 : 1);

    test(`FOG §12 ${kind}: one sight polygon ≤ ${polyMs} ms`, () => {
      const prep = prepareOccluders(s.walls);
      const src = s.players[0]?.[0] as VisionSource;
      const r = kind === "typical" ? 12 : 24;
      const ms = median(() => {
        sightPolygon(src, r, prep);
      }, 31);
      const poly = sightPolygon(src, r, prep) as number[];
      results[`${kind} polygon ms`] = ms;
      results[`${kind} polygon vertices`] = poly.length / 2;
      results[`${kind} prepare ms`] = median(() => {
        prepareScene(s.walls, s.darkness);
      });
      expect(ms).toBeLessThanOrEqual(polyMs);
    });

    test(`FOG §12 ${kind}: a move (mover's polygons + sample tests + explored cells) ≤ ${moveMs} ms`, () => {
      const ms = median(() => {
        const scene = prepareScene(s.walls, s.darkness);
        const pts = samples(s);
        const v = playerVision(scene, s.players[0] as VisionSource[]);
        visibleCount(v, pts);
        exploredCells(v);
      });
      results[`${kind} move ms`] = ms;
      expect(ms).toBeLessThanOrEqual(moveMs);
    });

    test(`FOG §12 ${kind}: full-scene re-derive (static once, then per player) ≤ ${fullMs} ms`, () => {
      const ms = median(() => {
        const scene = prepareScene(s.walls, s.darkness);
        const pts = samples(s);
        for (const srcs of s.players) {
          const v = playerVision(scene, srcs);
          visibleCount(v, pts);
          exploredCells(v);
        }
      }, 9);
      results[`${kind} full re-derive ms`] = ms;
      expect(ms).toBeLessThanOrEqual(fullMs);
    });

    test(`FOG §12 ${kind}: the vision record at ${kind === "typical" ? 1 : 4} source(s) ≤ 48 KiB`, () => {
      const scene = prepareScene(s.walls, s.darkness);
      let max = 0;
      for (const srcs of s.players) {
        const v = playerVision(scene, srcs);
        const rec = {
          id: "scene-0123456789:player-0123456789",
          sceneId: "scene-0123456789",
          playerId: "player-0123456789",
          blind: v.blind,
          see: v.see,
          dark: v.dark,
          ...(v.inv.length > 0 ? { inv: v.inv } : {}),
        };
        max = Math.max(max, Buffer.byteLength(JSON.stringify(rec), "utf8"));
      }
      results[`${kind} vision record max B`] = max;
      expect(max).toBeLessThanOrEqual(48 * 1024);
    });
  }

  test("FOG §12 benchmark numbers (logged)", () => {
    console.log(
      `FOG §12 V0 benchmark:\n${Object.entries(results)
        .map(([k, v]) => `  ${k}: ${Number.isInteger(v) ? v : v.toFixed(2)}`)
        .join("\n")}`,
    );
    expect(Object.keys(results).length).toBeGreaterThan(0);
  });
});
