// FR-DICEX-106: force dice's own look.
import { describe, expect, test } from "bun:test";
import { richKindOf } from "../../die-fx";
import { LAND_S, rampAt, richSim } from "../fx-sim";
import { force } from "./force";
import { DT, fly, runLayer } from "./test-kit";

describe("FR-DICEX-106 force dice", () => {
  test("FR-DICEX-106 force dice wear a blue field: shells and hex plates while it rolls", () => {
    expect(richKindOf("force")).toBe("force");
    const [shell, hex] = force.preset.species;
    if (!shell || !hex) throw new Error("species");
    expect(shell.tile).toBe("force-shell");
    expect(hex.tile).toBe("force-hex");
    // Shells grow outward from the die.
    expect(shell.size[1]).toBeGreaterThan(shell.size[0]);
    const [r, , b] = rampAt(hex.ramp, 0.4);
    expect(b).toBeGreaterThan(r);
    expect(force.whileRolling).toBe(true);
    expect(force.aura?.size).toBe(3.4);
    const sim = richSim(force.preset, 1, 5);
    fly(sim, 1, 0.5);
    expect(sim.count).toBeGreaterThan(5);
  });

  test("FR-DICEX-106 force dice pop their field on landing, over by LAND_S", () => {
    const sim = richSim(force.preset, 1, 5);
    const dice = fly(sim, 1, 0.5);
    const before = sim.count;
    sim.burst(dice);
    expect(sim.count - before).toBeGreaterThan(30);
    const { layer } = runLayer("force", force, { rollS: 0.5, afterS: LAND_S + 2 * DT });
    expect(layer.active()).toBe(false);
    expect(layer.object.visible).toBe(false);
  });
});
