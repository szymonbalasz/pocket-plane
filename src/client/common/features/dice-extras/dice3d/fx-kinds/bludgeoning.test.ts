// FR-DICEX-106: bludgeoning dice's own look: a hammer blow at the landing only.
import { describe, expect, test } from "bun:test";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import { richKindOf } from "../../die-fx";
import { LAND_CLOCK_S, LAND_S, landClock } from "../fx-sim";
import { bludgeoning, HAMMER_GONE_S, HAMMER_HIT_S } from "./bludgeoning";
import { DT, runLayer } from "./test-kit";

/** The die's part of the pop: its hammer (the first pivot, after the three floor quads). */
const hammerOf = (extra: Group | undefined) => {
  const part = extra?.children[0];
  const pivot = part?.children[3];
  return pivot?.children[0] as Mesh | undefined;
};

describe("FR-DICEX-106 bludgeoning dice", () => {
  test("FR-DICEX-106 bludgeoning dice: nothing while rolling, a hammer slams the die at the landing", () => {
    expect(richKindOf("bludgeoning")).toBe("bludgeoning");
    expect(bludgeoning.whileRolling).toBe(false);
    expect(bludgeoning.tiles?.["bludgeon-dust"]).toBeDefined();
    const { layer, meshes } = runLayer("bludgeoning", bludgeoning, { n: 2, rollS: 0.5 });
    const extra = layer.object.children.at(-1) as Group;
    expect(extra.visible).toBe(false);
    const die = meshes[0] as Mesh;
    expect(die.scale.x).toBe(1);
    const hammer = hammerOf(extra);
    if (!hammer) throw new Error("hammer");
    layer.land();
    let t = 0.5;
    const end = t + LAND_S + 2 * DT;
    let squashed = 0;
    let shownAtHit = 0;
    let shownLate = 0;
    for (; t < end; t += DT) {
      layer.update(t, 1, 50);
      const since = landClock(t - 0.5);
      const opacity = (hammer.material as MeshBasicMaterial).opacity;
      if (since > HAMMER_HIT_S && since < HAMMER_HIT_S + 0.05) {
        squashed = Math.max(squashed, die.scale.x - 1);
        shownAtHit = Math.max(shownAtHit, opacity);
      }
      if (since > HAMMER_GONE_S && since < LAND_CLOCK_S) shownLate = Math.max(shownLate, opacity);
    }
    expect(squashed).toBeGreaterThan(0.05);
    expect(shownAtHit).toBeGreaterThan(0.9);
    expect(shownLate).toBe(0);
    // Over by LAND_S: the die is its own size again.
    expect(layer.active()).toBe(false);
    expect(die.scale.x).toBe(1);
    expect(die.scale.y).toBe(1);
  });

  test("FR-DICEX-106 bludgeoning dice: a miniature lands clean", () => {
    const { layer, meshes } = runLayer("bludgeoning", bludgeoning, { rollS: 0.5 });
    layer.land();
    for (let t = 0.5; t < 0.5 + HAMMER_HIT_S + 0.03; t += DT) layer.update(t, 1, 50);
    layer.clear();
    expect((meshes[0] as Mesh).scale.x).toBe(1);
    expect(layer.object.visible).toBe(false);
  });
});
