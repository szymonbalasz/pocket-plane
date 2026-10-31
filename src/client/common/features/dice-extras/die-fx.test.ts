// FR-DICEX-106: the damage effects' numbers: pure.
import { describe, expect, test } from "bun:test";
import { MODIFIER_DAMAGE_TYPES } from "@shared/effect-modifiers/schemas";
import { dieFxOf, flatGlow, fxCss, fxEnvelope, fxGlow, fxMote } from "./die-fx";

const PHYSICAL = ["bludgeoning", "piercing", "slashing"];

describe("FR-DICEX-106 damage dice effects", () => {
  test("FR-DICEX-106 every magical type has an effect, physical types none", () => {
    for (const type of MODIFIER_DAMAGE_TYPES) {
      if (PHYSICAL.includes(type)) expect(dieFxOf(type)).toBeNull();
      else expect(dieFxOf(type)).not.toBeNull();
    }
    expect(dieFxOf(null)).toBeNull();
    expect(dieFxOf(undefined)).toBeNull();
    expect(dieFxOf("sparkle")).toBeNull();
    expect(dieFxOf("constructor")).toBeNull();
  });

  test("FR-DICEX-106 fades in, and is gone by the end of the throw", () => {
    expect(fxEnvelope(0)).toBe(0);
    expect(fxEnvelope(0.5)).toBe(1);
    expect(fxEnvelope(1)).toBe(0);
    expect(fxEnvelope(2)).toBe(0);
    expect(fxEnvelope(0.9)).toBeLessThan(fxEnvelope(0.75));
  });

  test("FR-DICEX-106 stays subtle: the glow in its range, motes near the die", () => {
    for (const type of MODIFIER_DAMAGE_TYPES) {
      const fx = dieFxOf(type);
      if (!fx) continue;
      expect(fx.glow[1]).toBeLessThanOrEqual(0.9);
      for (let t = 0; t < 3; t += 0.037) {
        const g = fxGlow(fx, t, 2);
        expect(g).toBeGreaterThanOrEqual(fx.glow[0] - 1e-6);
        expect(g).toBeLessThanOrEqual(fx.glow[1] + 1e-6);
        const m = fxMote(fx, 2, 3, t);
        expect(m.alpha).toBeGreaterThanOrEqual(0);
        expect(m.alpha).toBeLessThanOrEqual(1);
        expect(Math.hypot(m.x, m.y)).toBeLessThan(4);
      }
    }
  });

  test("FR-DICEX-106 embers rise, every client draws the same", () => {
    const fire = dieFxOf("fire");
    if (!fire) throw new Error("fire");
    // On average over a throw, motes sit above the die (the screen's +y is down).
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 7; t += 0.01) {
      for (let i = 0; i < 6; i++, n++) sum += fxMote(fire, 0, i, t).y;
    }
    expect(sum / n).toBeLessThan(-0.2);
    expect(fxMote(fire, 1, 2, 0.5)).toEqual(fxMote(fire, 1, 2, 0.5));
    expect(fxCss(0x0000ff)).toBe("#0000ff");
    expect(flatGlow("fire")).toBe("#ff6a1a");
    expect(flatGlow("slashing")).toBeUndefined();
  });
});
