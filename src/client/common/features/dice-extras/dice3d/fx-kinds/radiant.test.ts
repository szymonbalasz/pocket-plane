// FR-DICEX-106: radiant dice's own look.
import { describe, expect, test } from "bun:test";
import { richKindOf } from "../../die-fx";
import { LAND_S, rampAt, richSim } from "../fx-sim";
import { radiant } from "./radiant";
import { DT, fly, runLayer } from "./test-kit";

describe("FR-DICEX-106 radiant dice", () => {
  test("FR-DICEX-106 radiant dice shine: golden rays, rising motes, a gold glow", () => {
    expect(richKindOf("radiant")).toBe("radiant");
    expect(radiant.aura?.frag).toContain("atan");
    const motes = radiant.preset.species[0];
    if (!motes) throw new Error("motes");
    expect(motes.drift[1]).toBeLessThan(0);
    const [r, g, b] = rampAt(motes.ramp, 0.4);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
    expect(radiant.preset.glow?.emissive).toBe(0xffaa2a);
  });

  test("FR-DICEX-106 radiant dice land in a sunburst, none in flight, over by LAND_S", () => {
    const sun = radiant.preset.emitters.find(
      (e) => radiant.preset.species[e.species]?.tile === "radiant-sun",
    );
    expect(sun?.rate).toBe(0);
    expect(sun?.burst).toBeGreaterThan(0);
    const sim = richSim(radiant.preset, 1, 5);
    const dice = fly(sim, 1, 0.5);
    const tiles = () => Array.from({ length: sim.count }, (_, i) => sim.drawn(i, 1).tile);
    expect(tiles()).not.toContain("radiant-sun");
    sim.burst(dice);
    expect(tiles()).toContain("radiant-sun");
    const { layer } = runLayer("radiant", radiant, { rollS: 0.5, afterS: LAND_S + 2 * DT });
    expect(layer.active()).toBe(false);
  });
});
