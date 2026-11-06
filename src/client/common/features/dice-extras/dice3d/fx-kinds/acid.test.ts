// FR-DICEX-106: acid dice's own look.
import { describe, expect, test } from "bun:test";
import type { MeshStandardMaterial } from "three";
import { richKindOf } from "../../die-fx";
import { LAND_S, rampAt } from "../fx-sim";
import { acid } from "./acid";
import { runLayer } from "./test-kit";

describe("FR-DICEX-106 acid dice", () => {
  test("FR-DICEX-106 acid dice bubble: green bubbles swell round the rim and pop", () => {
    expect(richKindOf("acid")).toBe("acid");
    const [bubbles, pops] = acid.preset.species;
    if (!bubbles || !pops) throw new Error("species");
    expect(bubbles.tile).toBe("acid-bubble");
    expect(pops.tile).toBe("acid-pop");
    expect(Object.keys(acid.tiles ?? {}).sort()).toEqual(["acid-bubble", "acid-pop"]);
    // Green, swelling, still there just before the end, then gone: a pop.
    const [r, g, b] = rampAt(bubbles.ramp, 0.5);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(bubbles.size[1]).toBeGreaterThan(bubbles.size[0] * 2);
    expect(rampAt(bubbles.ramp, 0.85)[3]).toBeGreaterThan(0.8);
    expect(rampAt(bubbles.ramp, 1)[3]).toBe(0);
    // Born round the rim, not over the die's face.
    expect(bubbles.from[0]).toBeGreaterThanOrEqual(0.85);
    expect(acid.whileRolling).toBe(true);
    expect(acid.aura?.frag).toContain("drip");
  });

  test("FR-DICEX-106 acid dice glow green in flight and land clean", () => {
    const { layer, meshes } = runLayer("acid", acid, { n: 2, rollS: 0.6 });
    const m = meshes[0]?.material as MeshStandardMaterial;
    expect(m.emissiveIntensity).toBeGreaterThan(0);
    expect(m.emissive.g).toBeGreaterThan(m.emissive.r);
    layer.land();
    for (let t = 0.6; t <= 0.6 + LAND_S + 0.05; t += 1 / 60) layer.update(t, 1, 50);
    expect(layer.active()).toBe(false);
    expect(m.emissiveIntensity).toBe(0);
    expect(m.color.r).toBe(1);
  });
});
