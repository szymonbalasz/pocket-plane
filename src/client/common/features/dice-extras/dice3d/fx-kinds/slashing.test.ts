// FR-DICEX-106: slashing dice's own look: a blade swipe across the die at the landing only.
import { describe, expect, test } from "bun:test";
import type { Group, Mesh, MeshStandardMaterial, ShaderMaterial } from "three";
import { richKindOf } from "../../die-fx";
import { LAND_CLOCK_S, LAND_GLOW_S, LAND_PACE, LAND_S } from "../fx-sim";
import { SLASH_GONE_S, slashing } from "./slashing";
import { DT, runLayer } from "./test-kit";

describe("FR-DICEX-106 slashing dice", () => {
  test("FR-DICEX-106 slashing dice: nothing while rolling, a swipe cuts across the die and it flashes", () => {
    expect(richKindOf("slashing")).toBe("slashing");
    expect(slashing.whileRolling).toBe(false);
    expect(SLASH_GONE_S).toBeLessThan(LAND_CLOCK_S);
    const { layer, meshes } = runLayer("slashing", slashing, { rollS: 0.5 });
    const m = (meshes[0] as Mesh).material as MeshStandardMaterial;
    // No glow in flight.
    expect(m.emissiveIntensity).toBe(0);
    const extra = layer.object.children.at(-1) as Group;
    expect(extra.visible).toBe(false);
    const blade = extra.children[0]?.children[0] as Mesh;
    const uT = (blade.material as ShaderMaterial).uniforms.uT as { value: number };
    layer.land();
    layer.update(0.5, 1, 50);
    expect(extra.visible).toBe(true);
    expect(uT.value).toBe(0);
    expect(m.emissiveIntensity).toBeGreaterThan(0.1);
    let t = 0.5;
    for (; t < 0.5 + LAND_GLOW_S / LAND_PACE + DT; t += DT) layer.update(t, 1, 50);
    // The flash is gone, the value reads clean; all of it by LAND_S.
    expect(m.emissiveIntensity).toBe(0);
    for (; t < 0.5 + LAND_S + 2 * DT; t += DT) layer.update(t, 1, 50);
    expect(layer.active()).toBe(false);
    expect(layer.object.visible).toBe(false);
  });
});
