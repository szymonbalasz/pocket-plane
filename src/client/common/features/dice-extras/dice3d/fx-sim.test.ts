// FR-DICEX-106: the full effect's particle simulation (pure), run on fire's and cold's presets.
// Each kind's own tests: fx-kinds/<kind>.test.ts; the registry's: fx-kinds/index.test.ts.
import { describe, expect, test } from "bun:test";
import { REST_MS } from "../timing";
import { fire } from "./fx-kinds/fire";
import { frost } from "./fx-kinds/frost";
import {
  budgetScale,
  LAND_CLOCK_S,
  LAND_GLOW_S,
  LAND_PACE,
  LAND_S,
  landClock,
  landFade,
  landGlow,
  MAX_PARTICLES,
  rampAt,
  richAmp,
  richSim,
  type SimDie,
} from "./fx-sim";

const KINDS = [fire.preset, frost.preset];
const DT = 1 / 60;

/** Dice flying along +x for `s` seconds; returns the last positions. */
function fly(sim: ReturnType<typeof richSim>, n: number, s: number): SimDie[] {
  let dice: SimDie[] = [];
  for (let t = 0; t < s; t += DT) {
    dice = Array.from({ length: n }, (_, k) => ({ x: t * 12, y: 0.7, z: k * 3, r: 0.65 }));
    sim.step(DT, dice, true);
  }
  return dice;
}

describe("FR-DICEX-106 fire and cold dice", () => {
  test("FR-DICEX-106 particles move with their die, no trail behind it", () => {
    for (const kind of KINDS) {
      const sim = richSim(kind, 2, 7);
      const dice = fly(sim, 2, 0.6);
      expect(sim.count).toBeGreaterThan(30);
      // The dice fly along +x at 12 units / s: every particle stays around its own die, as many
      // ahead of it as behind (a trail would leave them strung out behind).
      let behind = 0;
      for (let i = 0; i < sim.count; i++) {
        const p = sim.drawn(i, 1);
        const near = dice.filter((d) => Math.hypot(p.x - d.x, p.z - d.z) < d.r * 4);
        expect(near.length).toBeGreaterThan(0);
        if (p.x < (near[0] as SimDie).x) behind++;
      }
      expect(behind / sim.count).toBeGreaterThan(0.3);
      expect(behind / sim.count).toBeLessThan(0.7);
    }
  });

  test("FR-DICEX-106 the landing bursts once and is over by LAND_S", () => {
    for (const kind of KINDS) {
      const sim = richSim(kind, 1, 3);
      const dice = fly(sim, 1, 0.5);
      const before = sim.count;
      sim.burst(dice);
      expect(sim.count).toBeGreaterThan(before + 40);
      // Rested: no more shedding; everything has faded or died by LAND_S (the landing clock's end).
      for (let t = 0; t < LAND_S; t += DT) sim.step(DT * LAND_PACE, dice, false);
      expect(landFade(LAND_CLOCK_S)).toBe(0);
      expect(landGlow(LAND_GLOW_S)).toBe(0);
      expect(landGlow(0)).toBeGreaterThan(1);
      expect(LAND_S * 1000).toBeLessThan(REST_MS); // before the hand-off (FR-DICEX-35)
    }
  });

  test("FR-DICEX-106 the landing lasts 1.4 s, slowed as a whole, before the hand-off at rest + 1.5 s (DM 2026-11-06)", () => {
    expect(LAND_S).toBeCloseTo(1.4, 6);
    expect(REST_MS).toBe(1500);
    expect(landClock(LAND_S)).toBeCloseTo(LAND_CLOCK_S, 9);
    expect(LAND_PACE).toBeLessThan(1);
    // Still showing past the old 0.9 s end; gone at the new one.
    expect(landFade(landClock(0.9))).toBeGreaterThan(0.2);
    expect(landFade(landClock(LAND_S))).toBeCloseTo(0, 6);
  });

  test("FR-DICEX-106 big rolls share one particle budget", () => {
    expect(budgetScale(1)).toBe(1);
    expect(budgetScale(2)).toBe(1);
    expect(budgetScale(8)).toBeCloseTo(0.5);
    for (const kind of KINDS) {
      const one = richSim(kind, 1, 1);
      fly(one, 1, 1);
      const many = richSim(kind, 20, 1);
      const dice = fly(many, 20, 1);
      // Thinner per die than a lone die.
      expect(many.count / 20).toBeLessThan(one.count * 0.5);
      // Never more than the cap, bursts and all.
      many.burst(dice);
      many.burst(dice);
      expect(many.count).toBeLessThanOrEqual(MAX_PARTICLES);
    }
  });

  test("FR-DICEX-106 every client sheds the same particles", () => {
    const a = richSim(fire.preset, 2, 11);
    const b = richSim(fire.preset, 2, 11);
    fly(a, 2, 0.3);
    fly(b, 2, 0.3);
    expect(a.count).toBe(b.count);
    expect(a.drawn(5, 1)).toEqual(b.drawn(5, 1));
  });

  test("FR-DICEX-106 colours stay in range", () => {
    for (const kind of KINDS) {
      for (const s of kind.species) {
        for (let t = 0; t <= 1; t += 0.05) {
          for (const c of rampAt(s.ramp, t)) {
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  test("FR-DICEX-106 the glow fades in, flares at the landing and is gone by LAND_GLOW_S", () => {
    expect(richAmp(true, 0, null)).toBe(0);
    expect(richAmp(true, 0.5, null)).toBe(1);
    expect(richAmp(true, 1, 0)).toBeGreaterThan(1);
    expect(richAmp(true, 1, LAND_GLOW_S)).toBe(0);
  });
});
