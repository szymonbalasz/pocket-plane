// FR-DICEX-106: necrotic dice's own look.
import { describe, expect, test } from "bun:test";
import { type MeshStandardMaterial, type Object3D, Sprite } from "three";
import { richKindOf } from "../../die-fx";
import { LAND_S, rampAt } from "../fx-sim";
import { necrotic } from "./necrotic";
import { runLayer } from "./test-kit";

const faces = (o: Object3D): Sprite[] => {
  const out: Sprite[] = [];
  o.traverse((x) => {
    // Faces draw over their halos.
    if (x instanceof Sprite && x.renderOrder === 5) out.push(x);
  });
  return out;
};

describe("FR-DICEX-106 necrotic dice", () => {
  test("FR-DICEX-106 necrotic dice drain: black smoke drawn in, purple wisps, violet glow", () => {
    expect(richKindOf("necrotic")).toBe("necrotic");
    const [smoke, wisps] = necrotic.preset.species;
    if (!smoke || !wisps) throw new Error("species");
    // Drawn in toward the die, from outside it.
    expect(smoke.speed[1]).toBeLessThan(0);
    expect(smoke.from[0]).toBeGreaterThan(1);
    const [r, g, b] = rampAt(smoke.ramp, 0.5);
    expect(Math.max(r, g, b)).toBeLessThan(0.25);
    const [wr, wg, wb] = rampAt(wisps.ramp, 0.4);
    expect(wb).toBeGreaterThan(wr);
    expect(wr).toBeGreaterThan(wg);
    expect(necrotic.preset.glow?.emissive).toBe(0x7a22d0);
  });

  test("FR-DICEX-106 necrotic skulls circle their die and fly off on landing", () => {
    const { layer, meshes } = runLayer("necrotic", necrotic, { n: 1, rollS: 0.8 });
    const die = meshes[0];
    if (!die) throw new Error("die");
    const skulls = faces(layer.object);
    expect(skulls).toHaveLength(3);
    for (const s of skulls) {
      const away = Math.hypot(s.position.x - die.position.x, s.position.z - die.position.z);
      expect(away / 0.65).toBeGreaterThan(1.1);
      expect(away / 0.65).toBeLessThan(1.8);
      expect(s.material.opacity).toBeGreaterThan(0.5);
      // Dark skulls.
      expect(s.material.color.r).toBeLessThan(0.3);
    }
    layer.land();
    layer.update(0.8, 1, 50);
    layer.update(1.1, 1, 50);
    const out = skulls.map((s) => Math.hypot(s.position.x, s.position.z) / 0.65);
    expect(Math.min(...out)).toBeGreaterThan(1.5);
    for (let t = 1.1; t <= 0.8 + LAND_S + 0.05; t += 1 / 60) layer.update(t, 1, 50);
    expect(layer.active()).toBe(false);
    expect((die.material as MeshStandardMaterial).emissiveIntensity).toBe(0);
  });
});
