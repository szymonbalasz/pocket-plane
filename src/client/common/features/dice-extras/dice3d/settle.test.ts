// FR-DICEX-14 / -15: die geometry, up-face + relabel, and the headless settle (cannon-es, no
// renderer): every seeded throw rests or snaps within 150 steps and shows the server value.
import { describe, expect, test } from "bun:test";
import { type DieShape, throwDice } from "@shared/dice-extras/throw";
import { type Arena, arenaOf, dieSizePx, pixelRatioOf, screenArena, shadowsFor } from "../arena";
import {
  cross,
  defaultLabels,
  dot,
  geometryOf,
  LABEL_VALUES,
  type LabelKind,
  labelKindOf,
  normalize,
  type Quat,
  relabel,
  sub,
  tilt,
  upFace,
} from "./geometry";
import { MAX_STEPS, POSE, prng, seedOf, settleLabels, simulate } from "./settle";

const SHAPES: DieShape[] = ["d4", "d6", "d8", "d10", "d12", "d20"];
const SEEDS = Array.from({ length: 20 }, (_, i) => seedOf(`entry-${i}`));
const FACES: Record<DieShape, number> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

function randomQuat(r: () => number): Quat {
  const [u1, u2, u3] = [r(), r() * 2 * Math.PI, r() * 2 * Math.PI];
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

describe("FR-DICEX-14 die geometry", () => {
  test.each(SHAPES)("%s: face count, outward planar faces, labels = the value set", (shape) => {
    const g = geometryOf(shape);
    expect(g.faces).toHaveLength(FACES[shape]);
    g.faces.forEach((f, i) => {
      const n = g.normals[i] as readonly [number, number, number];
      expect(g.inradius[i]).toBeGreaterThan(0); // outward
      for (const v of f) {
        // planar: every vertex on the face plane
        expect(dot(g.vertices[v] as never, n)).toBeCloseTo(g.inradius[i] as number, 6);
      }
      // counter-clockwise from outside: consecutive edges turn around +n
      const [a, b, c] = f.map((v) => g.vertices[v]) as [never, never, never];
      expect(dot(normalize(cross(sub(b, a), sub(c, b))), n)).toBeGreaterThan(0.99);
    });
    const kind = labelKindOf(shape);
    expect([...defaultLabels(g, kind)].sort((a, b) => a - b)).toEqual([...LABEL_VALUES[kind]]);
  });

  test("opposite faces sum like a real die (d6: 7, d20: 21)", () => {
    for (const [shape, sum] of [
      ["d6", 7],
      ["d8", 9],
      ["d12", 13],
      ["d20", 21],
    ] as const) {
      const g = geometryOf(shape);
      const labels = defaultLabels(g, shape);
      g.normals.forEach((n, i) => {
        const j = g.normals.findIndex((m) => dot(m, n) < -0.999);
        expect((labels[i] as number) + (labels[j] as number)).toBe(sum);
      });
    }
  });
});

describe("FR-DICEX-15 upFace + relabel", () => {
  const kinds: [DieShape, LabelKind][] = [
    ...SHAPES.map((s) => [s, s] as [DieShape, LabelKind]),
    ["d10", "d10-tens"],
    ["d10", "d10-units"],
  ];
  test.each(kinds)("%s (%s): every landed pose × every target → the target", (shape, kind) => {
    const g = geometryOf(shape);
    const r = prng(7);
    for (let k = 0; k < 40; k++) {
      const q = randomQuat(r);
      for (const target of LABEL_VALUES[kind]) {
        const labels = relabel(g, defaultLabels(g, kind), q, target);
        expect(upFace(g, labels, q)).toBe(target);
        // still a permutation of the value set
        expect([...labels].sort((a, b) => a - b)).toEqual([...LABEL_VALUES[kind]]);
      }
    }
  });
});

/** One die's simulated final orientation per seed. */
function finals(shape: DieShape, kind: LabelKind) {
  return SEEDS.map((seed) => simulate([{ shape, kind }], seed));
}

describe("FR-DICEX-15 headless settle", () => {
  test.each(SHAPES)("%s: 20 seeds × every target value → upFace == target", (shape) => {
    const g = geometryOf(shape);
    for (const sim of finals(shape, shape)) {
      expect(sim.steps).toBeLessThanOrEqual(MAX_STEPS);
      expect(sim.frameCount).toBeLessThanOrEqual(MAX_STEPS + 1);
      const q = sim.final[0] as Quat;
      expect(tilt(g, q)).toBeLessThanOrEqual((12 * Math.PI) / 180); // rests flat (or snapped)
      for (const target of LABEL_VALUES[shape]) {
        const [labels] = settleLabels(sim, [target]);
        expect(upFace(g, labels as number[], q)).toBe(target);
      }
    }
  });

  test("d100: 20 seeds × 1–100 → tens + units read back (100 → 00 + 0)", () => {
    const g = geometryOf("d10");
    for (const seed of SEEDS) {
      const sim = simulate(
        [
          { shape: "d10", kind: "d10-tens" },
          { shape: "d10", kind: "d10-units" },
        ],
        seed,
      );
      expect(sim.steps).toBeLessThanOrEqual(MAX_STEPS);
      for (let v = 1; v <= 100; v++) {
        const t = throwDice([
          {
            id: "e1",
            n: 1,
            kind: "roll",
            public: true,
            rollerRole: "player",
            rollerPlayerId: "p1",
            actorName: "Mira",
            payload: [
              {
                expression: "1d100",
                manual: false,
                dice: [{ faces: 100, value: v, kept: true }],
                constant: 0,
                total: v,
                label: null,
              },
            ],
          },
        ]);
        const dice = t?.dice ?? [];
        expect(dice.map((d) => d.d100)).toEqual(["tens", "units"]);
        const labels = settleLabels(
          sim,
          dice.map((d) => d.value as number),
        );
        const tens = upFace(g, labels[0] as number[], sim.final[0] as Quat);
        const units = upFace(g, labels[1] as number[], sim.final[1] as Quat);
        expect(tens + units === 0 ? 100 : tens + units).toBe(v);
        if (v === 100) expect([dice[0]?.face, dice[1]?.face]).toEqual(["00", "0"]);
      }
    }
  });

  test("seed determinism: same seed → the same tumble; another seed → another", () => {
    const dice = SHAPES.map((s) => ({ shape: s, kind: s }) as const);
    const a = simulate(dice, seedOf("entry-abc"));
    const b = simulate(dice, seedOf("entry-abc"));
    const c = simulate(dice, seedOf("entry-abd"));
    expect(seedOf("entry-abc")).toBe(seedOf("entry-abc"));
    expect(Array.from(a.frames)).toEqual(Array.from(b.frames));
    expect(a.final).toEqual(b.final);
    expect(Array.from(c.frames.subarray(POSE * dice.length))).not.toEqual(
      Array.from(a.frames.subarray(POSE * dice.length)),
    );
  });

  test("20 dice: precompute ≤ 50 ms (best of 3), ≤ 150 steps, every die at rest", () => {
    const dice = Array.from({ length: 20 }, (_, i) => {
      const s = SHAPES[i % SHAPES.length] as DieShape;
      return { shape: s, kind: s };
    });
    let best = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      const sim = simulate(dice, seedOf(`twenty-${k}`));
      best = Math.min(best, performance.now() - t0);
      expect(sim.steps).toBeLessThanOrEqual(MAX_STEPS);
      sim.final.forEach((q, i) => {
        expect(tilt(geometryOf(dice[i]?.shape as DieShape), q)).toBeLessThanOrEqual(
          (12 * Math.PI) / 180,
        );
      });
    }
    expect(best).toBeLessThanOrEqual(50);
  });
});

/** FR-DICEX-34: the screen arenas of DICEX §13 and the popup's PiP (≈ 260×96, small dice). */
const ARENAS: [string, Arena][] = [
  ["1280×720", screenArena({ w: 1280, h: 720 })],
  ["1440×900", screenArena({ w: 1440, h: 900 })],
  ["1920×1080", screenArena({ w: 1920, h: 1080 })],
  ["390×844", screenArena({ w: 390, h: 844 })],
  ["PiP 260×96", arenaOf({ w: 260, h: 96 }, 24)],
];
const TYPES: [DieShape, LabelKind][] = [
  ...SHAPES.map((s) => [s, s] as [DieShape, LabelKind]),
  ["d10", "d10-tens"],
  ["d10", "d10-units"],
];

describe("FR-DICEX-34 animation lands on the server's faces", () => {
  test.each(ARENAS)(
    "%s: every die type × every target × 10 seeds → upFace = target",
    (_, arena) => {
      for (const [shape, kind] of TYPES) {
        const g = geometryOf(shape);
        for (let s = 0; s < 10; s++) {
          const sim = simulate([{ shape, kind }], seedOf(`arena-${s}`), arena);
          expect(sim.steps).toBeLessThanOrEqual(MAX_STEPS);
          const q = sim.final[0] as Quat;
          expect(tilt(g, q)).toBeLessThanOrEqual((12 * Math.PI) / 180);
          // The die rests inside the arena's walls.
          const last = (sim.frameCount - 1) * POSE;
          expect(Math.abs(sim.frames[last] as number)).toBeLessThanOrEqual(arena.x);
          expect(Math.abs(sim.frames[last + 2] as number)).toBeLessThanOrEqual(arena.z);
          for (const target of LABEL_VALUES[kind]) {
            const [labels] = settleLabels(sim, [target]);
            expect(upFace(g, labels as number[], q)).toBe(target);
          }
        }
      }
    },
  );

  test.each(ARENAS)(
    "%s: 20 dice ≤ 50 ms (best of 3), ≤ 150 steps, every face = its value",
    (_, arena) => {
      const dice = Array.from({ length: 20 }, (_, i) => {
        const s = SHAPES[i % SHAPES.length] as DieShape;
        return { shape: s, kind: s };
      });
      const values = dice.map((d, i) => (i % Number(d.shape.slice(1))) + 1);
      let best = Number.POSITIVE_INFINITY;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        const sim = simulate(dice, seedOf(`arena-twenty-${k}`), arena);
        best = Math.min(best, performance.now() - t0);
        expect(sim.steps).toBeLessThanOrEqual(MAX_STEPS);
        const labels = settleLabels(sim, values);
        // Relabelling moves face labels only: the values themselves never change.
        expect(values).toEqual(dice.map((d, i) => (i % Number(d.shape.slice(1))) + 1));
        sim.final.forEach((q, i) => {
          const g = geometryOf(dice[i]?.shape as DieShape);
          expect(upFace(g, labels[i] as number[], q)).toBe(values[i] as number);
        });
      }
      expect(best).toBeLessThanOrEqual(50);
    },
  );

  test("dice enter from the bottom edge and cross the screen to the far wall (1440×900)", () => {
    const arena = screenArena({ w: 1440, h: 900 });
    let reached = 0;
    for (let s = 0; s < 10; s++) {
      const sim = simulate([{ shape: "d20", kind: "d20" }], seedOf(`cross-${s}`), arena);
      expect(sim.frames[2] as number).toBeGreaterThan(arena.z / 2); // starts in the bottom half
      let minZ = Number.POSITIVE_INFINITY;
      for (let f = 0; f < sim.frameCount; f++)
        minZ = Math.min(minZ, sim.frames[f * POSE + 2] as number);
      if (minZ < -arena.z / 2) reached += 1;
    }
    expect(reached).toBeGreaterThanOrEqual(7);
  });

  test("equal viewports (to 50 px) run the same simulation; another shape another path, same faces", () => {
    const a = screenArena({ w: 1280, h: 720 });
    expect(screenArena({ w: 1290, h: 715 })).toEqual(a);
    const dice = [{ shape: "d20", kind: "d20" }] as const;
    const one = simulate(dice, seedOf("e1"), a);
    const two = simulate(dice, seedOf("e1"), screenArena({ w: 1290, h: 715 }));
    expect(Array.from(two.frames)).toEqual(Array.from(one.frames));
    const other = simulate(dice, seedOf("e1"), screenArena({ w: 390, h: 844 }));
    expect(Array.from(other.frames)).not.toEqual(Array.from(one.frames));
    const g = geometryOf("d20");
    for (const sim of [one, other]) {
      const [labels] = settleLabels(sim, [17]);
      expect(upFace(g, labels as number[], sim.final[0] as Quat)).toBe(17);
    }
  });
});

describe("FR-DICEX-33 FR-DICEX-44 die size, pixel ratio, shadows", () => {
  test("FR-DICEX-33 dice layer die size: 7 % of the short side, clamped 40–96 px", () => {
    expect(dieSizePx({ w: 390, h: 844 })).toBe(40);
    expect(dieSizePx({ w: 1440, h: 900 })).toBe(63);
    expect(dieSizePx({ w: 2560, h: 1440 })).toBe(96);
  });

  test("FR-DICEX-44 slow devices: pixel ratio ≤ 1.5; no shadows above 2.5 MP", () => {
    expect(pixelRatioOf(1)).toBe(1);
    expect(pixelRatioOf(2)).toBe(1.5);
    expect(pixelRatioOf(3)).toBe(1.5);
    expect(pixelRatioOf(0)).toBe(1);
    expect(shadowsFor({ w: 2560, h: 1440 })).toBe(false);
    expect(shadowsFor({ w: 1440, h: 900 })).toBe(true);
  });
});
