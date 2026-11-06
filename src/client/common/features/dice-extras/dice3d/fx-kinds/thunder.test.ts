// FR-DICEX-106: thunder dice's own look.
import { describe, expect, test } from "bun:test";
import type { Mesh, ShaderMaterial } from "three";
import { richKindOf } from "../../die-fx";
import { LAND_S, rampAt } from "../fx-sim";
import type { RichExtra } from "./kind";
import { dieMesh, runLayer } from "./test-kit";
import { thunder } from "./thunder";

/** The extra for one die, its cloud's and its rings' uniforms, and its flash. */
function extraOf(seed = 3) {
  const mesh = dieMesh();
  mesh.position.set(0, 0.7, 0);
  const make = thunder.extra;
  if (!make) throw new Error("extra");
  const extra: RichExtra = make([{ mesh, radius: 0.65 }], seed);
  const [flash, ring, cloud] = extra.object.children as Mesh[];
  const u = (m: Mesh | undefined) => {
    if (!m) throw new Error("mesh");
    return (m.material as ShaderMaterial).uniforms;
  };
  return { extra, flash: flash as Mesh, ring: u(ring), cloud: u(cloud) };
}

describe("FR-DICEX-106 thunder dice", () => {
  test("FR-DICEX-106 thunder dice roll in a thundercloud: dark puffs, the die goes storm grey", () => {
    expect(richKindOf("thunder")).toBe("thunder");
    const puffs = thunder.preset.species[0];
    if (!puffs) throw new Error("puffs");
    expect(puffs.tile).toBe("thunder-puff");
    expect(puffs.additive).toBe(false);
    const [r, g, b, a] = rampAt(puffs.ramp, 0.4);
    expect(Math.max(r, g, b)).toBeLessThan(0.45);
    expect(a).toBeGreaterThan(0.3);
    expect(thunder.preset.glow?.tint).toBeDefined();
    expect(thunder.whileRolling).toBe(true);
  });

  test("FR-DICEX-106 thunder: a cloud in flight, a clap and shockwave at landing, gone before LAND_S", () => {
    const { extra, flash, ring, cloud } = extraOf();
    extra.update(0.5, 0.5, 50, null);
    expect(cloud.uAmp?.value).toBe(1);
    expect(cloud.uOpen?.value).toBe(0);
    extra.land();
    extra.update(1, 1, 50, 0);
    const lit = () => flash.geometry.getAttribute("aI").array.filter((v) => v > 0).length;
    expect(lit()).toBeGreaterThan(0);
    expect(cloud.uFlash?.value).toBeGreaterThan(1);
    extra.update(1.2, 1, 50, 0.2);
    const front = ring.uA?.value as { x: number; z: number };
    expect(front.x).toBeGreaterThan(3);
    expect(front.z).toBeGreaterThan(0);
    expect(lit()).toBe(0);
    extra.update(1.6, 1, 50, 0.6);
    expect(cloud.uOpen?.value).toBe(1);
    expect((ring.uA as { value: { z: number } }).value.z).toBe(0);
    expect((ring.uB as { value: { z: number } }).value.z).toBe(0);
    expect(0.6).toBeLessThan(LAND_S);
    extra.dispose();
  });

  test("FR-DICEX-106 thunder's flashes come from the seed only", () => {
    const a = extraOf(11);
    const b = extraOf(11);
    for (let t = 0; t < 2; t += 0.05) {
      a.extra.update(t, Math.min(1, t), 50, null);
      b.extra.update(t, Math.min(1, t), 50, null);
      expect(a.cloud.uFlash?.value).toBe(b.cloud.uFlash?.value);
    }
  });

  test("FR-DICEX-106 thunder lands clean through the layer", () => {
    const { layer, meshes } = runLayer("thunder", thunder, { n: 2, afterS: LAND_S + 0.05 });
    expect(layer.active()).toBe(false);
    expect(layer.object.visible).toBe(false);
    const m = meshes[0]?.material as unknown as { color: { r: number } };
    expect(m.color.r).toBe(1);
  });
});
