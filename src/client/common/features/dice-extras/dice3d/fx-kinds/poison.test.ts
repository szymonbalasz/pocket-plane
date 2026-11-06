// FR-DICEX-106: poison dice's own look, and the skulls it shares with necrotic.
import { describe, expect, test } from "bun:test";
import { type Object3D, Sprite } from "three";
import { richKindOf } from "../../die-fx";
import { LAND_S, rampAt } from "../fx-sim";
import { necrotic } from "./necrotic";
import { poison } from "./poison";
import { type SkullStyle, skullExtra } from "./skull";
import { dieMesh, runLayer, stubCanvas } from "./test-kit";

/** The skull sprites under `o` (faces and their halos). */
const sprites = (o: Object3D): Sprite[] => {
  const out: Sprite[] = [];
  o.traverse((x) => {
    if (x instanceof Sprite) out.push(x);
  });
  return out;
};

describe("FR-DICEX-106 poison dice", () => {
  test("FR-DICEX-106 poison dice fume: yellow-green fumes rise off the die", () => {
    expect(richKindOf("poison")).toBe("poison");
    const [fumes] = poison.preset.species;
    if (!fumes) throw new Error("fumes");
    expect(fumes.tile).toBe("poison-fume");
    expect(fumes.drift[1]).toBeLessThan(0);
    const [r, g, b] = rampAt(fumes.ramp, 0.4);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b * 2);
    // Under the die's top: the die hides the fumes behind it, so its value reads.
    expect(fumes.lift).toBeLessThan(1);
    // The landing gust is a ring from the rim, not a cloud over the die.
    const gust = poison.preset.emitters.find((e) => e.rate === 0 && e.burst > 0);
    const gs = poison.preset.species[gust?.species ?? -1];
    expect(gs?.from[0]).toBeGreaterThanOrEqual(0.9);
    expect(poison.preset.emitters[0]?.burst).toBe(0);
  });

  test("FR-DICEX-106 poison skulls rise upright in flight and are gone by LAND_S", () => {
    const { layer } = runLayer("poison", poison, { n: 2, rollS: 1 });
    const all = sprites(layer.object);
    // Two skulls per die at most, each a face and a halo.
    expect(all.length).toBe(2 * 2 * 2);
    expect(all.some((s) => s.material.opacity > 0.3)).toBe(true);
    for (const s of all) expect(Math.abs(s.material.rotation)).toBeLessThan(0.5);
    layer.land();
    for (let t = 1; t <= 1 + LAND_S + 0.05; t += 1 / 60) layer.update(t, 1, 50);
    expect(layer.active()).toBe(false);
    expect(layer.object.visible).toBe(false);
    for (const s of all) expect(s.material.opacity).toBe(0);
  });

  test("FR-DICEX-106 poison and necrotic share one skull; skulls follow the budget", () => {
    expect(poison.extra).toBeDefined();
    expect(necrotic.extra).toBeDefined();
    const dice = (n: number) =>
      Array.from({ length: n }, () => ({ mesh: dieMesh(), radius: 0.65 }));
    const style = { color: 0xffffff, halo: 0xffffff, per: 3, motion: "orbit", size: 1 } as const;
    // The skulls' canvases are made with the extra; no DOM stub left behind for later files.
    const make = (n: number, seed: number, s: SkullStyle) => {
      const unstub = stubCanvas();
      try {
        return skullExtra(dice(n), seed, s);
      } finally {
        unstub();
      }
    };
    expect(sprites(make(2, 1, style).object)).toHaveLength(2 * 3 * 2);
    // 20 dice: fewer skulls per die (budgetScale), at least one each.
    const many = sprites(make(20, 1, style).object).length;
    expect(many).toBeLessThan(20 * 3 * 2);
    expect(many).toBeGreaterThanOrEqual(20 * 2);
    // Deterministic: the same seed puts the skulls in the same places.
    const a = make(1, 9, { ...style, motion: "rise" });
    const b = make(1, 9, { ...style, motion: "rise" });
    a.update(0.7, 0.5, 50, null);
    b.update(0.7, 0.5, 50, null);
    const pa = sprites(a.object).map((s) => [s.position.x, s.position.z, s.material.opacity]);
    const pb = sprites(b.object).map((s) => [s.position.x, s.position.z, s.material.opacity]);
    expect(pa).toEqual(pb);
  });
});
