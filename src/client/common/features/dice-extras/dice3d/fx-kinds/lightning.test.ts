// FR-DICEX-106: lightning dice's own look.
import { describe, expect, test } from "bun:test";
import type { Mesh } from "three";
import { richKindOf } from "../../die-fx";
import { LAND_S, rampAt } from "../fx-sim";
import type { RichExtra } from "./kind";
import { BOLT_POINTS, jag, lightning, sliceRand } from "./lightning";
import { dieMesh, runLayer } from "./test-kit";

/** The extra for `n` dice in a row, and its bolt mesh. */
function extraOf(n: number, seed = 5): { extra: RichExtra; bolts: Mesh } {
  const dice = Array.from({ length: n }, (_, k) => {
    const mesh = dieMesh();
    mesh.position.set(k * 2, 0.7, 0);
    return { mesh, radius: 0.65 };
  });
  const make = lightning.extra;
  if (!make) throw new Error("extra");
  const extra = make(dice, seed);
  return { extra, bolts: extra.object.children[0] as Mesh };
}

const lit = (bolts: Mesh) => bolts.geometry.getAttribute("aI").array.filter((v) => v > 0).length;

describe("FR-DICEX-106 lightning dice", () => {
  test("FR-DICEX-106 lightning dice crackle: blue-white sparks and zaps, a corona, a flicker", () => {
    expect(richKindOf("lightning")).toBe("lightning");
    const [sparks, zaps] = lightning.preset.species;
    if (!sparks || !zaps) throw new Error("species");
    const [r, , b] = rampAt(sparks.ramp, 0.8);
    expect(b).toBeGreaterThan(r);
    expect(zaps.tile).toBe("lightning-zap");
    expect(Object.keys(lightning.tiles ?? {})).toEqual(["lightning-zap"]);
    expect(lightning.whileRolling).toBe(true);
    expect(lightning.aura?.frag).toContain("uniform float uAmp");
    expect(lightning.preset.glow?.hz).toBeGreaterThan(10);
  });

  test("FR-DICEX-106 lightning bolts are jagged paths of at most BOLT_POINTS points", () => {
    const pts = jag([0, 0, 10, 0], 4, 0.3, sliceRand(1, 0, 0));
    expect(pts.length / 2).toBe(BOLT_POINTS);
    expect([pts[0], pts[1], pts.at(-2), pts.at(-1)]).toEqual([0, 0, 10, 0]);
    expect(pts.some((v, i) => i % 2 === 1 && Math.abs(v) > 0.1)).toBe(true);
  });

  test("FR-DICEX-106 lightning arcs crackle in flight, strike at landing, are gone before LAND_S", () => {
    const { extra, bolts } = extraOf(2);
    let seen = 0;
    for (let t = 0; t < 1; t += 1 / 30) {
      extra.update(t, t, 50, null);
      seen = Math.max(seen, lit(bolts));
    }
    expect(seen).toBeGreaterThan(0);
    extra.land();
    extra.update(1.03, 1, 50, 0.03);
    const strike = lit(bolts);
    expect(strike).toBeGreaterThan(seen / 2);
    extra.update(1.7, 1, 50, 0.7);
    expect(lit(bolts)).toBe(0);
    expect(0.7).toBeLessThan(LAND_S);
    extra.dispose();
  });

  test("FR-DICEX-106 lightning is the same on every client: bolts from the seed only", () => {
    const a = extraOf(3, 9);
    const b = extraOf(3, 9);
    for (const at of [0.2, 0.55]) {
      a.extra.update(at, at, 50, null);
      b.extra.update(at, at, 50, null);
      expect([...a.bolts.geometry.getAttribute("position").array]).toEqual([
        ...b.bolts.geometry.getAttribute("position").array,
      ]);
    }
  });

  test("FR-DICEX-106 lightning lands clean through the layer", () => {
    const { layer } = runLayer("lightning", lightning, { n: 3, afterS: LAND_S + 0.05 });
    expect(layer.active()).toBe(false);
    expect(layer.object.visible).toBe(false);
  });
});
