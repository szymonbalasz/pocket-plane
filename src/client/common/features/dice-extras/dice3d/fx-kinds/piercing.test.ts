// FR-DICEX-106: piercing dice's own look: an arrow at the landing only.
import { describe, expect, test } from "bun:test";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import { richKindOf } from "../../die-fx";
import { LAND_S, landClock } from "../fx-sim";
import { ARROW_GONE_S, ARROW_HIT_S, piercing } from "./piercing";
import { DT, runLayer } from "./test-kit";

describe("FR-DICEX-106 piercing dice", () => {
  test("FR-DICEX-106 piercing dice: nothing while rolling, an arrow drives into the die's side, it lands back in place", () => {
    expect(richKindOf("piercing")).toBe("piercing");
    expect(piercing.whileRolling).toBe(false);
    expect(piercing.tiles?.["pierce-splinter"]).toBeDefined();
    const { layer, meshes } = runLayer("piercing", piercing, { rollS: 0.5 });
    const die = meshes[0] as Mesh;
    die.position.set(2, 0.6, -1);
    const extra = layer.object.children.at(-1) as Group;
    expect(extra.visible).toBe(false);
    const pivot = extra.children[0]?.children[0] as Group;
    const arrow = pivot.children[0] as Mesh;
    layer.land();
    let t = 0.5;
    const seen: { since: number; tip: number; along: number; opacity: number; knock: number }[] =
      [];
    for (; t < 0.5 + LAND_S + 2 * DT; t += DT) {
      layer.update(t, 1, 50);
      seen.push({
        since: landClock(t - 0.5),
        tip: Math.hypot(pivot.position.x - 2, pivot.position.z + 1),
        along: arrow.position.x,
        opacity: (arrow.material as MeshBasicMaterial).opacity,
        knock: Math.hypot(die.position.x - 2, die.position.z + 1),
      });
    }
    // The tip rests just inside the die, at its middle height (the die covers it).
    expect(seen[1]?.tip ?? 9).toBeLessThan(0.65 * 0.3);
    expect(pivot.position.y).toBeLessThan(0.6);
    // It flies in: far back at first, still once it struck.
    const first = seen[1]?.along ?? 0;
    const struck = seen.filter((s) => s.since > ARROW_HIT_S + DT);
    expect(first).toBeLessThan((struck[0]?.along ?? 0) - 2);
    expect(new Set(struck.map((s) => s.along.toFixed(6))).size).toBe(1);
    expect(Math.max(...struck.filter((s) => s.since < 0.3).map((s) => s.opacity))).toBe(1);
    expect(Math.max(...struck.filter((s) => s.since > ARROW_GONE_S).map((s) => s.opacity))).toBe(0);
    // The blow knocks the die back a touch; it is back in its place when the landing ends.
    expect(Math.max(...seen.map((s) => s.knock))).toBeGreaterThan(0.05);
    expect(layer.active()).toBe(false);
    expect([die.position.x, die.position.y, die.position.z]).toEqual([2, 0.6, -1]);
  });

  test("FR-DICEX-106 piercing dice: the same seed shoots from the same side", () => {
    const heading = (seed: number) => {
      const { layer } = runLayer("piercing", piercing, { seed, rollS: 0.2, afterS: 0.2 });
      const pivot = (layer.object.children.at(-1) as Group).children[0]?.children[0] as Group;
      return pivot.rotation.y;
    };
    expect(heading(4)).toBe(heading(4));
    expect(heading(4)).not.toBe(heading(5));
  });
});
