// FR-DICEX-106: cold dice's own look (kind "frost").
import { describe, expect, test } from "bun:test";
import { richKindOf } from "../../die-fx";
import { rampAt } from "../fx-sim";
import { frost } from "./frost";

describe("FR-DICEX-106 cold dice", () => {
  test("FR-DICEX-106 cold dice frost over: flakes are cold, the die is tinted while it rolls", () => {
    expect(richKindOf("cold")).toBe("frost");
    const flakes = frost.preset.species[1];
    if (!flakes) throw new Error("flakes");
    expect(flakes.tile).toBe("flake");
    const [r, , b] = rampAt(flakes.ramp, 0.4);
    expect(b).toBeGreaterThan(r);
    expect(frost.preset.glow?.tint).toBeDefined();
    expect(frost.aura?.size).toBe(2.8);
  });
});
