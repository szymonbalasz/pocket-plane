// FR-DICEX-106: psychic dice's own look.
import { describe, expect, test } from "bun:test";
import { richKindOf } from "../../die-fx";
import { LAND_S, rampAt, richSim } from "../fx-sim";
import { psychic } from "./psychic";
import { DT, fly, runLayer } from "./test-kit";

describe("FR-DICEX-106 psychic dice", () => {
  test("FR-DICEX-106 psychic dice ping: many small purple ripples round the die", () => {
    expect(richKindOf("psychic")).toBe("psychic");
    const pings = psychic.preset.species[0];
    if (!pings) throw new Error("pings");
    expect(pings.tile).toBe("psychic-ping");
    // Small rings that grow, born round the die rather than on it.
    expect(pings.size[0]).toBeLessThan(0.5);
    expect(pings.size[1]).toBeGreaterThan(pings.size[0]);
    expect(pings.from[0]).toBeGreaterThanOrEqual(1);
    const [r, g, b] = rampAt(pings.ramp, 0.4);
    expect(b).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(g);
    const sim = richSim(psychic.preset, 1, 5);
    fly(sim, 1, 0.5);
    const alive = Array.from({ length: sim.count }, (_, i) => sim.drawn(i, 1));
    expect(alive.filter((p) => p.tile === "psychic-ping").length).toBeGreaterThanOrEqual(8);
  });

  test("FR-DICEX-106 psychic dice send a wave of pings on landing, over by LAND_S", () => {
    const sim = richSim(psychic.preset, 1, 5);
    const dice = fly(sim, 1, 0.5);
    const before = sim.count;
    sim.burst(dice);
    expect(sim.count - before).toBeGreaterThan(30);
    const { layer } = runLayer("psychic", psychic, { rollS: 0.5, afterS: LAND_S + 2 * DT });
    expect(layer.active()).toBe(false);
  });
});
