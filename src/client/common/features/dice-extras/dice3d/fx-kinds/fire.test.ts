// FR-DICEX-106: fire dice's own look.
import { describe, expect, test } from "bun:test";
import { richKindOf } from "../../die-fx";
import { rampAt } from "../fx-sim";
import { fire } from "./fire";

describe("FR-DICEX-106 fire dice", () => {
  test("FR-DICEX-106 fire dice burn: flames are hot, the die glows while it rolls", () => {
    expect(richKindOf("fire")).toBe("fire");
    const flames = fire.preset.species[0];
    if (!flames) throw new Error("flames");
    expect(flames.tile).toBe("flame");
    const [r, , b] = rampAt(flames.ramp, 0.4);
    expect(r).toBeGreaterThan(b);
    expect(fire.whileRolling).toBe(true);
    expect(fire.aura?.size).toBe(3.2);
  });
});
