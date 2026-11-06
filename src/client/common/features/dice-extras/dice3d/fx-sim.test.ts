// FR-DICEX-106: fire and cold dice's full effect, the particle simulation: pure.
import { describe, expect, test } from "bun:test";
import { dieFxOf } from "../die-fx";
import {
  budgetScale,
  LAND_GLOW_S,
  LAND_S,
  landFade,
  landGlow,
  MAX_PARTICLES,
  RICH,
  type RichKind,
  rampAt,
  richSim,
  type SimDie,
} from "./fx-sim";

const KINDS: RichKind[] = ["fire", "frost"];
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
  test("FR-DICEX-106 fire and cold dice have the full effect, other types the subtle one", () => {
    expect(dieFxOf("fire")?.rich).toBe("fire");
    expect(dieFxOf("cold")?.rich).toBe("frost");
    expect(dieFxOf("lightning")?.rich).toBeUndefined();
    expect(dieFxOf("necrotic")?.rich).toBeUndefined();
  });

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
      // Rested: no more shedding; everything has faded or died by LAND_S.
      for (let t = 0; t < LAND_S; t += DT) sim.step(DT, dice, false);
      expect(landFade(LAND_S)).toBe(0);
      expect(landGlow(LAND_GLOW_S)).toBe(0);
      expect(landGlow(0)).toBeGreaterThan(1);
      expect(LAND_S).toBeLessThan(1); // before the 1 s hand-off (FR-DICEX-35)
    }
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
    const a = richSim("fire", 2, 11);
    const b = richSim("fire", 2, 11);
    fly(a, 2, 0.3);
    fly(b, 2, 0.3);
    expect(a.count).toBe(b.count);
    expect(a.drawn(5, 1)).toEqual(b.drawn(5, 1));
  });

  test("FR-DICEX-106 colours stay in range; fire is hot, frost is cold", () => {
    for (const kind of KINDS) {
      for (const s of RICH[kind].species) {
        for (let t = 0; t <= 1; t += 0.05) {
          for (const c of rampAt(s.ramp, t)) {
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    const [fr, , fb] = rampAt((RICH.fire.species[0] as (typeof RICH.fire.species)[0]).ramp, 0.4);
    expect(fr).toBeGreaterThan(fb);
    const [cr, , cb] = rampAt((RICH.frost.species[1] as (typeof RICH.frost.species)[1]).ramp, 0.4);
    expect(cb).toBeGreaterThan(cr);
  });
});
