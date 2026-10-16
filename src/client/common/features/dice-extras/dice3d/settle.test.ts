// FR-DICEX-14 / -15: die geometry, up-face + relabel, and the headless settle (cannon-es, no
// renderer): every seeded throw rests or snaps within 150 steps and shows the server value.
import { describe, expect, test } from "bun:test";
import { type DieShape, throwDice } from "@shared/dice-extras/throw";
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
