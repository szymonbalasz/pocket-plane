// FOG v2 vision (FOG §13 unit rows): FR-FOG-33 sight polygon goldens + a property test against
// brute-force rays, FR-FOG-34 sample points, FR-FOG-36 blind matrix, FR-FOG-46 invisible matrix.
// Goblin Ambush walls (`scn-walls`): x = 8 for y 0–5, 6–11, 12–14; d1 (8, 5)–(8, 6); d2
// (8, 11)–(8, 12); `vision-crypt`'s freeform wall [4.5, 3.25, 6.75, 5.5].
import { describe, expect, test } from "bun:test";
import { wallLeftByDoor } from "@shared/scene-tools/geometry";
import { uniformMask } from "./mask";
import type { ShapeLike } from "./shapes";
import {
  boundPolygon,
  invisibleSeen,
  NO_SENSES,
  playerVision,
  pointInPolygon,
  pointVisible,
  polygonCells,
  prepareScene,
  prepareStaticLayer,
  type Seg,
  type Senses,
  samplePoint,
  sightPolygon,
  sightPolygons,
} from "./vision";

const WALLS: Seg[] = [
  [8, 0, 8, 5],
  [8, 6, 8, 11],
  [8, 12, 8, 14],
];
const D1: Seg = [8, 5, 8, 6];
const D2: Seg = [8, 11, 8, 12];
const FREE: Seg = [4.5, 3.25, 6.75, 5.5];
const CLOSED = [...WALLS, D1, D2, FREE];
const OPEN = [...WALLS, D2, FREE];

const xs = (p: readonly number[]) => p.filter((_, i) => i % 2 === 0);
const pts = (p: readonly number[]) => {
  const out: [number, number][] = [];
  for (let i = 0; i < p.length; i += 2) out.push([p[i] as number, p[i + 1] as number]);
  return out;
};

/** mulberry32: seeded PRNG for reproducible random scenes (no Math.random). */
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

describe("FR-SCN-56 sight through a door over a wall", () => {
  // A hand-drawn wall (points off the grid), a door placed on it slightly off the line.
  const WALL: Seg = [7.01, 5, 14.01, 5.02];
  const DOOR: Seg = [9.02, 5.12, 10.02, 4.95];
  const pieces = wallLeftByDoor([...DOOR], [...WALL]) as Seg[];
  const eye = { x: 9.5, y: 8 };
  const sees = (occluders: Seg[], x: number, y: number) =>
    pointInPolygon(sightPolygon(eye, 40, occluders) as number[], x, y);

  test("FR-SCN-56 open door: sight passes through it, not through the wall beside it", () => {
    expect(pieces).toHaveLength(2);
    expect(sees(pieces, 9.5, 2)).toBe(true);
    expect(sees(pieces, 13.5, 2)).toBe(false);
    // The wall left under the door blocked sight, open or not.
    expect(sees([WALL], 9.5, 2)).toBe(false);
  });

  test("FR-SCN-56 closed door: nothing leaks past the joints, from any angle", () => {
    const closed = [...pieces, DOOR];
    for (let i = 0; i <= 40; i++) {
      const p = sightPolygon({ x: 7.5 + i * 0.15, y: 8 }, 40, closed) as number[];
      for (let j = 0; j <= 40; j++) expect(pointInPolygon(p, 8 + j * 0.1, 2)).toBe(false);
    }
  });
});

describe("FR-FOG-33 sightPolygon goldens", () => {
  test("FR-FOG-33 empty room = the 64-gon bound", () => {
    const p = sightPolygon({ x: 2.5, y: 7.5 }, 6, []) as number[];
    expect(p).toEqual(boundPolygon({ x: 2.5, y: 7.5 }, 6));
    expect(p.length).toBe(128);
    for (const [x, y] of pts(p)) expect(Math.hypot(x - 2.5, y - 7.5)).toBeCloseTo(6, 1);
  });

  test("FR-FOG-33 r = 0 → no polygon", () => {
    expect(sightPolygon({ x: 2.5, y: 7.5 }, 0, CLOSED)).toBeNull();
  });

  test("FR-FOG-33 wall shadow: Mira (2, 7) never sees past x = 8, nor behind the freeform wall", () => {
    const p = sightPolygon({ x: 2.5, y: 7.5 }, 6, CLOSED) as number[];
    expect(Math.max(...xs(p))).toBeLessThanOrEqual(8);
    expect(pointInPolygon(p, 7.5, 7.5)).toBe(true);
    // (6, 3) → (6.5, 3.5) is behind the freeform wall (FOG §13 checked geometry).
    expect(pointInPolygon(p, 6.5, 3.5)).toBe(false);
    // The nook (1, 10): d 3.16, no wall between.
    expect(pointInPolygon(p, 1.5, 10.5)).toBe(true);
  });

  test("FR-FOG-33 door open / closed: Mira (7, 5) sees Goblin (12, 6) only through open d1", () => {
    const open = sightPolygon({ x: 7.5, y: 5.5 }, 6, OPEN) as number[];
    const closed = sightPolygon({ x: 7.5, y: 5.5 }, 6, CLOSED) as number[];
    expect(pointInPolygon(open, 12.5, 6.5)).toBe(true);
    expect(pointInPolygon(closed, 12.5, 6.5)).toBe(false);
    // Cell (11, 6) → (11.5, 6.5) through d1 (FOG §13: becomes Explored for P1).
    expect(pointInPolygon(open, 11.5, 6.5)).toBe(true);
  });

  test("FR-FOG-33 Thorn (2, 9), d1 closed: every vertex with 0 ≤ y ≤ 14 has x ≤ 8", () => {
    const p = sightPolygon({ x: 2.5, y: 9.5 }, 12, CLOSED) as number[];
    for (const [x, y] of pts(p)) if (y >= 0 && y <= 14) expect(x).toBeLessThanOrEqual(8);
    // d1 open: a narrow wedge through the doorway (at x = 11.5: y ≈ 2.1–3.8; no token there).
    const o = sightPolygon({ x: 2.5, y: 9.5 }, 12, OPEN) as number[];
    expect(pointInPolygon(o, 11.5, 3)).toBe(true);
    expect(pointInPolygon(o, 12.5, 6.5)).toBe(false);
    expect(pointInPolygon(o, 12.5, 8.5)).toBe(false);
    expect(pointInPolygon(o, 12.5, 0.9)).toBe(false);
    expect(pointInPolygon(o, 12.5, 3.5)).toBe(false);
  });

  test("FR-FOG-33 a ray through a wall endpoint passes it; the wall still shadows behind", () => {
    // Wall (5, 2)–(5, 6); origin (2, 2): the ray along y = 2 grazes the endpoint (5, 2).
    const p = sightPolygon({ x: 2, y: 2 }, 10, [[5, 2, 5, 6]]) as number[];
    expect(pointInPolygon(p, 9, 1.9)).toBe(true);
    expect(pointInPolygon(p, 9, 3)).toBe(false);
    expect(pointInPolygon(p, 4.9, 4)).toBe(true);
  });

  test("FR-FOG-33 a collinear wall (on the origin's line) does not occlude", () => {
    const p = sightPolygon({ x: 2.5, y: 2.5 }, 8, [[4.5, 2.5, 7.5, 2.5]]) as number[];
    expect(pointInPolygon(p, 6, 3)).toBe(true);
    expect(pointInPolygon(p, 6, 2)).toBe(true);
    expect(pointInPolygon(p, 9, 2.6)).toBe(true);
  });

  test("FR-FOG-33 origin exactly on a wall: both sides seen, the wall still cuts beyond", () => {
    // Origin on wall A (y = 5); a second wall B parallel at y = 8 cuts beyond.
    const occ: Seg[] = [
      [0, 5, 10, 5],
      [0, 8, 10, 8],
    ];
    const p = sightPolygon({ x: 5, y: 5 }, 6, occ) as number[];
    expect(pointInPolygon(p, 5, 3)).toBe(true);
    expect(pointInPolygon(p, 5, 7)).toBe(true);
    expect(pointInPolygon(p, 5, 9)).toBe(false);
  });

  test("FR-FOG-33 freeform decimals and rounding: every vertex has ≤ 2 decimals", () => {
    const p = sightPolygon({ x: 3.5, y: 4.5 }, 7, [FREE, [1.13, 0.27, 2.91, 8.66]]) as number[];
    for (const v of p) expect(Math.abs(Math.round(v * 100) - v * 100)).toBeLessThan(1e-6);
    // The rounded polygon is what `seenBy` uses: rounding is idempotent.
    expect(p.map((v) => Math.round(v * 100) / 100)).toEqual(p);
  });

  test("FR-FOG-33 darkness occluder vs see-through; origin in darkness → no polygon", () => {
    const darkness: ShapeLike[] = [{ circle: [12.5, 9, 1.5] }];
    const scene = prepareScene(OPEN, darkness);
    const senses = (through: boolean): Senses => ({
      visionFt: 0,
      darkvisionFt: 60,
      seesMagicalDarkness: through,
    });
    // Thorn at (11, 9) → (11.5, 9.5) is in the darkness circle (d 1.12).
    const without = playerVision(scene, [{ x: 11.5, y: 9.5, senses: senses(false) }]);
    expect(without.blind).toBe(true);
    expect(without.dark).toEqual([]);
    const withIt = playerVision(scene, [{ x: 11.5, y: 9.5, senses: senses(true) }]);
    expect(withIt.blind).toBe(false);
    const poly = withIt.dark[0] as number[];
    expect(pointInPolygon(poly, 12.5, 8.5)).toBe(true); // Goblin 2 (d 1.41)
    expect(pointInPolygon(poly, 12.5, 6.5)).toBe(true); // Goblin (d 3.16)
    expect(pointInPolygon(poly, 17.5, 11.5)).toBe(true); // Lurker (d 6.32)
    // A source outside the darkness without see-through: sight stops at its edge.
    const outside = playerVision(scene, [{ x: 11.5, y: 4.5, senses: senses(false) }]);
    const o = outside.dark[0] as number[];
    expect(pointInPolygon(o, 12.5, 6.5)).toBe(true);
    expect(pointInPolygon(o, 12.5, 9)).toBe(false); // the circle's centre
    expect(pointInPolygon(o, 12.5, 12)).toBe(false); // behind it
  });

  test("FR-FOG-33 origin on a darkness edge = in darkness", () => {
    const scene = prepareScene([], [{ rect: [5, 5, 10, 10] }]);
    const v = playerVision(scene, [
      { x: 5, y: 7, senses: { visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false } },
    ]);
    expect(v.blind).toBe(true);
  });
});

describe("FR-FOG-33 property: polygon = brute-force rays", () => {
  /** O → P is blocked iff it touches an occluder not on the origin's line. */
  function blocked(o: [number, number], p: [number, number], occ: readonly Seg[]): boolean {
    for (const [ax, ay, bx, by] of occ) {
      const c = (ax - o[0]) * (by - o[1]) - (ay - o[1]) * (bx - o[0]);
      if (Math.abs(c) < 1e-12) continue; // through the origin's line: never occludes
      const d1 = (bx - ax) * (o[1] - ay) - (by - ay) * (o[0] - ax);
      const d2 = (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
      const d3 = (p[0] - o[0]) * (ay - o[1]) - (p[1] - o[1]) * (ax - o[0]);
      const d4 = (p[0] - o[0]) * (by - o[1]) - (p[1] - o[1]) * (bx - o[0]);
      if (d1 * d2 <= 0 && d3 * d4 <= 0) return true;
    }
    return false;
  }
  const distSeg = (x: number, y: number, s: Seg) => {
    const [ax, ay, bx, by] = s;
    const ex = bx - ax;
    const ey = by - ay;
    const ll = ex * ex + ey * ey;
    const t = ll === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / ll));
    return Math.hypot(x - ax - t * ex, y - ay - t * ey);
  };
  const ring = (p: readonly number[]): Seg[] =>
    pts(p).map((a, i, all) => {
      const b = all[(i + 1) % all.length] as [number, number];
      return [a[0], a[1], b[0], b[1]];
    });

  for (const [label, seed, scenes, maxSegs] of [
    ["60 random scenes × 400 points", 42, 60, 40],
    ["dense crossings: 15 scenes × 250 segments", 9, 15, 250],
  ] as const) {
    test(`FR-FOG-33 property: ${label} agree with brute-force rays away from boundaries`, () => {
      const rand = rng(seed);
      const r2 = (v: number) => Math.round(v * 100) / 100;
      let checked = 0;
      for (let sceneNo = 0; sceneNo < scenes; sceneNo++) {
        const o: [number, number] = [r2(10 + rand() * 4), r2(10 + rand() * 4)];
        const r = 2 + Math.floor(rand() * 11);
        const occ: Seg[] = [];
        const n = 1 + Math.floor(rand() * maxSegs);
        for (let i = 0; i < n; i++) {
          const x = r2(rand() * 24);
          const y = r2(rand() * 24);
          const a = rand() * Math.PI * 2;
          const len = 0.5 + rand() * 6;
          occ.push([x, y, r2(x + len * Math.cos(a)), r2(y + len * Math.sin(a))]);
        }
        // Some grid-aligned walls and shared endpoints (corners), as real scenes have.
        occ.push([8, 6, 8, 12], [8, 12, 14, 12], [14, 12, 14, 6]);
        const poly = sightPolygon({ x: o[0], y: o[1] }, r, occ) as number[];
        const bound = boundPolygon({ x: o[0], y: o[1] }, r);
        const edges = [...ring(poly), ...occ, ...ring(bound)];
        for (let k = 0; k < 400; k++) {
          const p: [number, number] = [o[0] - r + rand() * 2 * r, o[1] - r + rand() * 2 * r];
          if (edges.some((e) => distSeg(p[0], p[1], e) < 0.03)) continue;
          const expected = pointInPolygon(bound, p[0], p[1]) && !blocked(o, p, occ);
          expect([sceneNo, p, pointInPolygon(poly, p[0], p[1])]).toEqual([sceneNo, p, expected]);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(scenes * 100);
    });
  }
});

describe("FR-FOG-33 two radii from one sweep", () => {
  test("FR-FOG-33 sightPolygons(see, dark) = two separate sweeps (sampled)", () => {
    const rand = rng(5);
    for (let k = 0; k < 20; k++) {
      const o = { x: 4 + Math.round(rand() * 800) / 100, y: 4 + Math.round(rand() * 800) / 100 };
      const r1 = 1 + Math.floor(rand() * 8);
      const r2 = r1 + 1 + Math.floor(rand() * 8);
      const [a, b] = sightPolygons(o, [r1, r2], CLOSED) as [number[], number[]];
      expect(b).toEqual(sightPolygon(o, r2, CLOSED) as number[]);
      const direct = sightPolygon(o, r1, CLOSED) as number[];
      for (let j = 0; j < 300; j++) {
        const x = o.x - r1 + rand() * 2 * r1;
        const y = o.y - r1 + rand() * 2 * r1;
        if (pointInPolygon(a, x, y) !== pointInPolygon(direct, x, y)) {
          // Only within rounding distance of either boundary.
          const near = [a, direct].some((p) =>
            pts(p).some((v, i, all) => {
              const w = all[(i + 1) % all.length] as [number, number];
              const ex = w[0] - v[0];
              const ey = w[1] - v[1];
              const ll = ex * ex + ey * ey;
              const t =
                ll === 0 ? 0 : Math.max(0, Math.min(1, ((x - v[0]) * ex + (y - v[1]) * ey) / ll));
              return Math.hypot(x - v[0] - t * ex, y - v[1] - t * ey) < 0.02;
            }),
          );
          expect(near).toBe(true);
        }
      }
    }
  });

  test("FR-FOG-33 r = 0 among the radii → null for it only", () => {
    const [a, b] = sightPolygons({ x: 2.5, y: 7.5 }, [0, 6], CLOSED);
    expect(a).toBeNull();
    expect(b).toEqual(sightPolygon({ x: 2.5, y: 7.5 }, 6, CLOSED) as number[]);
  });
});

describe("FR-FOG-34 / -36 / -46 per player", () => {
  const torch: Senses = { visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false };
  const devil: Senses = { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true };
  const fogged = uniformMask("fog", [0, 0, 20, 14]);
  const clear = uniformMask("clear", [0, 0, 20, 14]);
  const DARK: ShapeLike[] = [{ circle: [12.5, 9, 1.5] }];
  const scene = prepareScene(CLOSED, DARK);
  const pt = (x: number, y: number, mask = fogged) =>
    samplePoint(prepareStaticLayer(mask, [], DARK), x, y);

  test("FR-FOG-34 visible = static clear outside darkness, or inside a polygon", () => {
    const v = playerVision(scene, [{ x: 2.5, y: 7.5, senses: torch }]);
    expect(pointVisible(v, pt(1.5, 10.5))).toBe(true); // in the polygon
    expect(pointVisible(v, pt(12.5, 6.5))).toBe(false); // behind x = 8
    expect(pointVisible(v, pt(12.5, 6.5, clear))).toBe(true); // statically clear
    expect(pointVisible(v, pt(12.5, 9, clear))).toBe(false); // clear but in darkness
    // Explored counts as hidden for records.
    const layer = prepareStaticLayer(fogged, [{ op: "explored", rect: [10, 5, 14, 8] }], []);
    const explored = samplePoint(layer, 12.5, 6.5);
    expect(explored.state).toBe("explored");
    expect(pointVisible(v, explored)).toBe(false);
  });

  test("FR-FOG-36 blind matrix", () => {
    const inside = { x: 11.5, y: 9.5 };
    const outside = { x: 2.5, y: 7.5 };
    const cases: [VisionSourceSpec[], boolean][] = [
      [[], false],
      [[{ ...inside, senses: torch }], true],
      [[{ ...inside, senses: devil }], false],
      [[{ ...outside, senses: torch }], false],
      [
        [
          { ...inside, senses: torch },
          { ...outside, senses: torch },
        ],
        false,
      ],
      [
        [
          { ...inside, senses: torch },
          { ...inside, senses: devil },
        ],
        false,
      ],
      [
        [
          { ...inside, senses: torch },
          { ...inside, senses: NO_SENSES },
        ],
        true,
      ],
    ];
    for (const [sources, blind] of cases) {
      const v = playerVision(scene, sources);
      expect([sources.length, v.blind]).toEqual([sources.length, blind]);
      if (blind) {
        expect(v.see).toEqual([]);
        expect(v.dark).toEqual([]);
        expect(pointVisible(v, pt(2.5, 7.5, clear))).toBe(false);
      }
    }
    // One in, one out: not blind; sight from the outside one only.
    const v = playerVision(scene, [
      { ...inside, senses: torch },
      { ...outside, senses: torch },
    ]);
    expect(v.see.length).toBe(1);
  });

  test("FR-FOG-46 invisible matrix (pure): only Sees-invisible polygons count", () => {
    const sees: Senses = { ...torch, seesInvisible: true };
    const none = playerVision(scene, [{ x: 2.5, y: 7.5, senses: torch }]);
    const withSi = playerVision(scene, [{ x: 2.5, y: 7.5, senses: sees }]);
    const nook = pt(1.5, 10.5, clear);
    // Statically clear never counts; in sight without the sense doesn't either.
    expect(invisibleSeen(none, nook)).toBe(false);
    expect(invisibleSeen(withSi, nook)).toBe(true);
    // Out of reach / behind a wall.
    expect(invisibleSeen(withSi, pt(2.5, 0.5, clear))).toBe(false);
    expect(invisibleSeen(withSi, pt(12.5, 6.5, clear))).toBe(false);
    // In darkness without see-through: a source in darkness has no polygon (blind sees nothing).
    const inDark = playerVision(scene, [{ x: 11.5, y: 9.5, senses: sees }]);
    expect(inDark.blind).toBe(true);
    expect(invisibleSeen(inDark, pt(12.5, 8.5, clear))).toBe(false);
    // With see-through and Sees invisible inside darkness: seen.
    const thorn = playerVision(scene, [
      { x: 11.5, y: 9.5, senses: { ...devil, seesInvisible: true } },
    ]);
    expect(invisibleSeen(thorn, pt(12.5, 8.5))).toBe(true);
  });

  test("FR-FOG-39 inv = indices into see ++ dark of Sees-invisible sources", () => {
    const v = playerVision(scene, [
      { x: 2.5, y: 7.5, senses: { visionFt: 30, darkvisionFt: 60, seesMagicalDarkness: false } },
      { x: 2.5, y: 9.5, senses: { ...devil, seesInvisible: true } },
    ]);
    expect(v.see.length).toBe(1);
    expect(v.dark.length).toBe(2);
    expect(v.inv).toEqual([2]);
    expect(v.polys.map((p) => p.kind)).toEqual(["see", "dark", "dark"]);
  });

  test("FR-FOG-37 polygonCells = cells whose centre is in the polygon", () => {
    const rand = rng(7);
    for (let k = 0; k < 20; k++) {
      const o = { x: 5 + rand() * 10, y: 5 + rand() * 10 };
      const p = sightPolygon(o, 3 + rand() * 8, CLOSED) as number[];
      const got: string[] = [];
      polygonCells(p, (c, r) => got.push(`${c},${r}`));
      const want: string[] = [];
      for (let r = -40; r < 60; r++)
        for (let c = -40; c < 60; c++)
          if (pointInPolygon(p, c + 0.5, r + 0.5)) want.push(`${c},${r}`);
      expect(got.sort()).toEqual(want.sort());
    }
  });
});

type VisionSourceSpec = { x: number; y: number; senses: Senses };
