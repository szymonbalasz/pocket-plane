// FOG §13 sprint-4 unit rows (V6): FR-FOG-32 default (absent = Normal 999 ft), FR-FOG-33 map
// edges, `dark` omission and inward-only simplification (property test against the exact
// polygon), FR-FOG-39 `src`, FR-FOG-50 party sight. Goblin Ambush: 20 × 14 cells, walls at x = 8.
import { describe, expect, test } from "bun:test";
import { uniformMask } from "./mask";
import {
  boundsEdges,
  mapBounds,
  NO_SENSES,
  NORMAL_SENSES,
  partyVision,
  playerVision,
  pointInPolygon,
  pointVisible,
  prepareScene,
  prepareStaticLayer,
  REACH_MAX_CELLS,
  type Seg,
  type Senses,
  SIMPLIFY_CELLS,
  samplePoint,
  senseRadii,
  sightPolygon,
  simplifyInward,
  sourcePolygons,
} from "./vision";

const WALLS: Seg[] = [
  [8, 0, 8, 5],
  [8, 6, 8, 11],
  [8, 12, 8, 14],
];
const MAP = { mapWidth: 1400, mapHeight: 980, gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const BOUNDS = mapBounds(MAP);

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

const pts = (p: readonly number[]) => {
  const out: [number, number][] = [];
  for (let i = 0; i < p.length; i += 2) out.push([p[i] as number, p[i + 1] as number]);
  return out;
};

/** Distance from (x, y) to the segment a → b. */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const ex = bx - ax;
  const ey = by - ay;
  const ll = ex * ex + ey * ey;
  const t = ll === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / ll));
  return Math.hypot(x - (ax + t * ex), y - (ay + t * ey));
}

/** Distance from (x, y) to the polygon's boundary. */
function edgeDist(flat: readonly number[], x: number, y: number) {
  const p = pts(flat);
  let d = Number.POSITIVE_INFINITY;
  for (let i = 0; i < p.length; i++) {
    const a = p[i] as [number, number];
    const b = p[(i + 1) % p.length] as [number, number];
    d = Math.min(d, segDist(x, y, a[0], a[1], b[0], b[1]));
  }
  return d;
}

describe("FR-FOG-32 default", () => {
  test("FR-FOG-32 default: no senses / no visionFt → Normal 999 ft = 199.8 cells; stored 0 kept; darkvision ≤ 120 ft", () => {
    expect(REACH_MAX_CELLS).toBe(199.8);
    expect(senseRadii(NORMAL_SENSES)).toEqual([199.8, 0]);
    expect(senseRadii({ darkvisionFt: 60, seesMagicalDarkness: false })).toEqual([199.8, 0]);
    expect(senseRadii(NO_SENSES)).toEqual([0, 0]);
    expect(senseRadii({ visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true })).toEqual([
      0, 12,
    ]);
    expect(senseRadii({ visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false })).toEqual([
      6, 0,
    ]);
    expect(senseRadii({ visionFt: 995, darkvisionFt: 0, seesMagicalDarkness: false })).toEqual([
      199, 0,
    ]);
    // Darkvision is capped at 120 ft even if a stored value were larger.
    expect(senseRadii({ visionFt: 0, darkvisionFt: 200, seesMagicalDarkness: false })[1]).toBe(24);
  });

  test("FR-FOG-33 dark omitted when darkvision ≤ vision: a Normal source has one polygon", () => {
    const scene = prepareScene(WALLS, [], BOUNDS);
    const normal = playerVision(scene, [
      { x: 2.5, y: 7.5, senses: { darkvisionFt: 60, seesMagicalDarkness: false }, id: "m" },
    ]);
    expect(normal.see).toHaveLength(1);
    expect(normal.dark).toEqual([]);
    const torch = playerVision(scene, [
      { x: 2.5, y: 7.5, senses: { visionFt: 30, darkvisionFt: 60, seesMagicalDarkness: false } },
    ]);
    expect([torch.see.length, torch.dark.length]).toEqual([1, 1]);
    const blindish = playerVision(scene, [{ x: 2.5, y: 7.5, senses: NO_SENSES }]);
    expect(blindish).toMatchObject({ blind: false, see: [], dark: [] });
  });
});

describe("FR-FOG-33 map edges", () => {
  test("FR-FOG-33 map edges: the map rectangle in grid units, rounded inward; a ray leaving the map stops on its edge", () => {
    expect(BOUNDS).toEqual([0, 0, 20, 14]);
    expect(mapBounds({ ...MAP, gridOffsetX: 35, gridOffsetY: -10 })).toEqual([
      -0.5, 0.15, 19.5, 14.14,
    ]);
    // 1/3 cell offsets round inward (fail closed).
    const b = mapBounds({ ...MAP, gridCellSize: 30, gridOffsetX: 10, gridOffsetY: 10 });
    expect(b[0]).toBe(-0.33);
    expect(b[2]).toBe(46.33);
    expect(boundsEdges(BOUNDS)).toHaveLength(4);
    // Normal vision in the nook: every vertex inside the map, the west / north / south edges hit.
    const scene = prepareScene(WALLS, [], BOUNDS);
    const [see] = sourcePolygons(scene, { x: 2.5, y: 7.5, senses: NORMAL_SENSES });
    const poly = see as number[];
    for (const [x, y] of pts(poly)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(20);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(14);
    }
    const xs = pts(poly).map((p) => p[0]);
    const ys = pts(poly).map((p) => p[1]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(14);
    // The wall at x = 8 still cuts it (doors closed: no gap in WALLS here but d1 / d2 openings).
    expect(pointInPolygon(poly, 12.5, 2.5)).toBe(false);
    // Without the bounds the polygon reaches far outside the map.
    const free = sightPolygon({ x: 2.5, y: 7.5 }, 199.8, WALLS) as number[];
    expect(Math.min(...pts(free).map((p) => p[0]))).toBeLessThan(-100);
  });
});

describe("FR-FOG-33 inward simplification", () => {
  test("FR-FOG-33 inward simplification: result inside the exact polygon; every dropped vertex convex and ≤ 0.05 cell from its chord", () => {
    const rand = rng(43);
    let dropped = 0;
    for (let k = 0; k < 60; k++) {
      const walls: Seg[] = [];
      for (let i = 0; i < 40; i++) {
        const x = rand() * 40;
        const y = rand() * 40;
        const a = rand() * 2 * Math.PI;
        const len = 0.5 + rand() * 4;
        walls.push([
          Math.round(x * 100) / 100,
          Math.round(y * 100) / 100,
          Math.round((x + len * Math.cos(a)) * 100) / 100,
          Math.round((y + len * Math.sin(a)) * 100) / 100,
        ]);
      }
      const o = { x: 10 + rand() * 20, y: 10 + rand() * 20 };
      const r = 3 + rand() * 30;
      const exact = sightPolygon(o, r, [...walls, ...boundsEdges([0, 0, 40, 40])]);
      if (!exact) continue;
      const simple = simplifyInward(exact, o);
      dropped += exact.length - simple.length;
      // Kept vertices are a subsequence of the exact ones.
      const keys = new Set(pts(exact).map(([x, y]) => `${x},${y}`));
      for (const [x, y] of pts(simple)) expect(keys.has(`${x},${y}`)).toBe(true);
      // Every simplified vertex lies inside (or on) the exact polygon; points inside the result
      // are inside the exact polygon (sampled).
      for (const [x, y] of pts(simple)) expect(pointInPolygon(exact, x, y)).toBe(true);
      for (let s = 0; s < 200; s++) {
        const x = o.x + (rand() * 2 - 1) * r;
        const y = o.y + (rand() * 2 - 1) * r;
        if (pointInPolygon(simple, x, y)) expect(pointInPolygon(exact, x, y)).toBe(true);
        // A point the exact polygon holds but the result doesn't is within 0.05 cell of an edge.
        else if (pointInPolygon(exact, x, y)) {
          expect(edgeDist(exact, x, y)).toBeLessThanOrEqual(SIMPLIFY_CELLS + 1e-6);
        }
      }
      // Every dropped vertex is within 0.05 cell of the simplified boundary and outside or on it.
      const kept = new Set(pts(simple).map(([x, y]) => `${x},${y}`));
      for (const [x, y] of pts(exact)) {
        if (kept.has(`${x},${y}`)) continue;
        expect(edgeDist(simple, x, y)).toBeLessThanOrEqual(SIMPLIFY_CELLS + 1e-6);
      }
    }
    expect(dropped).toBeGreaterThan(0);
  });

  test("FR-FOG-33 a point 0.02 cell inside the edge may go unseen; one outside never seen", () => {
    // A 64-gon of radius 6 loses vertices whose sagitta ≤ 0.05 (fail closed).
    const o = { x: 10.5, y: 10.5 };
    const exact = sightPolygon(o, 6, []) as number[];
    const simple = simplifyInward(exact, o);
    expect(simple.length).toBeLessThan(exact.length);
    // Just inside the exact bound, between two vertices: may drop out.
    let lost = 0;
    for (let k = 0; k < 360; k++) {
      const a = (k * Math.PI) / 180;
      const x = o.x + 5.98 * Math.cos(a);
      const y = o.y + 5.98 * Math.sin(a);
      if (pointInPolygon(exact, x, y) && !pointInPolygon(simple, x, y)) lost++;
      // Outside the exact polygon: never inside the simplified one.
      const ox = o.x + 6.05 * Math.cos(a);
      const oy = o.y + 6.05 * Math.sin(a);
      if (!pointInPolygon(exact, ox, oy)) expect(pointInPolygon(simple, ox, oy)).toBe(false);
    }
    expect(lost).toBeGreaterThan(0);
  });
});

describe("FR-FOG-39 src and FR-FOG-50 party sight", () => {
  const torch: Senses = { visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false };
  const devil: Senses = { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true };
  const darkness = [{ circle: [12.5, 9, 1.5] as [number, number, number] }];
  const scene = prepareScene(WALLS, darkness, BOUNDS);
  const layer = prepareStaticLayer(uniformMask("fog", [0, 0, 20, 14]), [], darkness);

  test("FR-FOG-39 src = the source id of each polygon of see ++ dark", () => {
    const v = playerVision(scene, [
      { x: 2.5, y: 7.5, senses: { ...torch, darkvisionFt: 60 }, id: "mira" },
      { x: 2.5, y: 9.5, senses: devil, id: "thorn" },
    ]);
    expect(v.src).toEqual(["mira", "mira", "thorn"]);
    expect(v.src).toHaveLength(v.see.length + v.dark.length);
  });

  test("FR-FOG-50 party sight: any polygon under its own see-through rule; party-blind only when every player with sources is blind", () => {
    const mira = playerVision(scene, [{ x: 2.5, y: 7.5, senses: torch }]);
    // Thorn in the darkness with see-through: sees Goblin 2 (12.5, 8.5) inside it.
    const thorn = playerVision(scene, [{ x: 11.5, y: 9.5, senses: devil }]);
    const party = partyVision([mira, thorn]) as NonNullable<ReturnType<typeof partyVision>>;
    expect(party.blind).toBe(false);
    expect(party.polys).toHaveLength(mira.polys.length + thorn.polys.length);
    const goblin2 = samplePoint(layer, 12.5, 8.5);
    expect(pointVisible(mira, goblin2)).toBe(false);
    expect(pointVisible(party, goblin2)).toBe(true);
    // Mira's polygon never counts inside darkness (no see-through): a point only she covers.
    expect(pointVisible(party, samplePoint(layer, 2.5, 4.5))).toBe(true);
    // Party-blind matrix.
    const blindTorch = playerVision(scene, [{ x: 11.5, y: 9.5, senses: torch }]);
    expect(blindTorch.blind).toBe(true);
    expect(partyVision([blindTorch])?.blind).toBe(true);
    expect(partyVision([blindTorch, blindTorch])?.blind).toBe(true);
    expect(partyVision([blindTorch, mira])?.blind).toBe(false);
    // A sightless (stored 0 / 0) player is not blind, so the party isn't either.
    const sightless = playerVision(scene, [{ x: 2.5, y: 7.5, senses: NO_SENSES }]);
    expect(partyVision([blindTorch, sightless])?.blind).toBe(false);
    expect(partyVision([])).toBeNull();
  });

  test("FR-FOG-50 invisible via any Sees-invisible polygon of the party", () => {
    const thornSi = playerVision(scene, [
      { x: 11.5, y: 9.5, senses: { ...devil, seesInvisible: true } },
    ]);
    const mira = playerVision(scene, [{ x: 2.5, y: 7.5, senses: torch }]);
    const party = partyVision([mira, thornSi]) as NonNullable<ReturnType<typeof partyVision>>;
    expect(party.polys.some((p) => p.seesInvisible && p.contains(12.5, 8.5))).toBe(true);
  });
});
