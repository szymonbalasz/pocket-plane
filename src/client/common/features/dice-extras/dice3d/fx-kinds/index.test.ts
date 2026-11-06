// FR-DICEX-106: the registry of full effects, and what every built kind must keep to.
import { describe, expect, test } from "bun:test";
import { MODIFIER_DAMAGE_TYPES } from "@shared/effect-modifiers/schemas";
import type { Mesh, MeshStandardMaterial } from "three";
import { type DieFx, dieFxOf, RICH_KINDS, type RichKind, richKindOf } from "../../die-fx";
import { splitFx } from "../fx-layer";
import {
  LAND_CLOCK_S,
  LAND_PACE,
  LAND_S,
  landFade,
  MAX_PARTICLES,
  rampAt,
  richSim,
} from "../fx-sim";
import { RICH_DEFS } from ".";
import { fire } from "./fire";
import type { RichExtra, RichKindDef } from "./kind";
import { DT, dieMesh, fly, runLayer } from "./test-kit";
import { atlasLayout, CORE_TILES } from "./tiles";

const built = Object.entries(RICH_DEFS).filter((e): e is [RichKind, RichKindDef] => e[1] !== null);

/** A physical-style kind: only a landing pop, with an extra. */
function popKind(log: string[]): RichKindDef {
  return {
    preset: {
      species: [
        {
          tile: "dot",
          additive: true,
          life: [0.2, 0.4],
          size: [1, 0.5],
          speed: [1, 2],
          drag: 2,
          drift: [0, 0],
          spin: 0,
          from: [0.5, 1],
          lift: 1.2,
          ramp: [
            [0, 1, 1, 1, 1],
            [1, 1, 1, 1, 0],
          ],
          twinkle: 0,
        },
      ],
      emitters: [{ species: 0, rate: 50, burst: 30, burstSpeed: 2 }],
    },
    whileRolling: false,
    extra: (dice, seed) => {
      log.push(`made ${dice.length} ${seed}`);
      const object = dieMesh();
      const extra: RichExtra = {
        object,
        update: (_t, _p, _u, since) => log.push(`update ${since === null ? "flight" : "land"}`),
        land: () => log.push("land"),
        clear: () => log.push("clear"),
        dispose: () => log.push("dispose"),
      };
      return extra;
    },
  };
}

describe("FR-DICEX-106 full effects, one kind per damage type", () => {
  test("FR-DICEX-106 every damage type maps to a kind in the registry", () => {
    expect(Object.keys(RICH_DEFS).sort()).toEqual([...RICH_KINDS].sort());
    for (const type of MODIFIER_DAMAGE_TYPES) {
      const kind = richKindOf(type);
      expect(kind).not.toBeNull();
      expect(Object.hasOwn(RICH_DEFS, kind as string)).toBe(true);
    }
    expect(richKindOf("cold")).toBe("frost");
    expect(richKindOf(null)).toBeNull();
    expect(richKindOf("constructor")).toBeNull();
    // Accepted by the DM (2026-11-06).
    expect(RICH_DEFS.fire).not.toBeNull();
    expect(RICH_DEFS.frost).not.toBeNull();
  });

  test("FR-DICEX-106 a kind not built yet keeps the subtle effect (physical: nothing)", () => {
    const mesh = {} as Mesh;
    const defs = { ...RICH_DEFS, lightning: null, slashing: null, fire };
    const die = (type: string) => ({
      mesh,
      fx: dieFxOf(type),
      rich: richKindOf(type),
      radius: 1,
    });
    const { rich, plain } = splitFx([die("fire"), die("lightning"), die("slashing")], defs);
    expect(rich.map((d) => d.kind)).toEqual(["fire"]);
    expect(plain.map((d) => d.fx)).toEqual([dieFxOf("lightning") as DieFx]);
    // Once slashing is built, its dice get it.
    const pop = popKind([]);
    const later = splitFx([die("slashing")], { ...defs, slashing: pop });
    expect(later.rich.map((d) => d.def)).toEqual([pop]);
  });

  test("FR-DICEX-106 a landing-only kind sheds nothing before land()", () => {
    const def = popKind([]);
    const sim = richSim(def.preset, 1, 3, def.whileRolling);
    const dice = fly(sim, 1, 0.5);
    expect(sim.count).toBe(0);
    sim.burst(dice);
    expect(sim.count).toBeGreaterThan(20);
  });

  test("FR-DICEX-106 the layer drives an extra: hidden in flight, landed once, cleared by LAND_S", () => {
    const log: string[] = [];
    const def = popKind(log);
    const { layer } = runLayer("slashing", def, { n: 2, rollS: 0.5 });
    const extra = layer.object.children.at(-1);
    expect(log).toEqual(["made 2 33"]);
    expect(extra?.visible).toBe(false);
    expect(layer.active()).toBe(false);
    layer.land();
    expect(layer.active()).toBe(true);
    let t = 0.5;
    layer.update(t, 1, 50);
    expect(log.slice(1, 3)).toEqual(["land", "update land"]);
    expect(extra?.visible).toBe(true);
    for (; t < 0.5 + LAND_S + 2 * DT; t += DT) layer.update(t, 1, 50);
    expect(layer.active()).toBe(false);
    expect(layer.object.visible).toBe(false);
    expect(log.filter((l) => l === "land")).toHaveLength(1);
    expect(log.at(-1)).toBe("clear");
    expect(log).not.toContain("update flight");
  });

  test("FR-DICEX-106 the landing runs slowed: an extra's sinceRest and time run at LAND_PACE, to LAND_CLOCK_S by LAND_S", () => {
    const seen: { t: number; since: number }[] = [];
    const def = popKind([]);
    const make = def.extra;
    if (!make) throw new Error("extra");
    def.extra = (dice, seed) => {
      const e = make(dice, seed);
      const update = e.update;
      e.update = (t, p, u, since) => {
        if (since !== null) seen.push({ t, since });
        update(t, p, u, since);
      };
      return e;
    };
    const { layer } = runLayer("slashing", def, { rollS: 0.5 });
    layer.land();
    let t = 0.5;
    for (; t < 0.5 + LAND_S + 2 * DT; t += DT) layer.update(t, 1, 50);
    expect(layer.active()).toBe(false);
    const k = Math.round(1 / DT); // 1 s of real time after rest
    expect(seen[0]).toEqual({ t: 0.5, since: 0 });
    expect(seen[k]?.since ?? 0).toBeCloseTo(k * DT * LAND_PACE, 6);
    expect(seen[k]?.t ?? 0).toBeCloseTo(0.5 + k * DT * LAND_PACE, 6);
    expect(Math.max(...seen.map((s) => s.since))).toBeLessThan(LAND_CLOCK_S);
    expect(Math.max(...seen.map((s) => s.since))).toBeGreaterThan(LAND_CLOCK_S - 2 * DT);
  });

  test("FR-DICEX-106 a die glows in flight and lands clean", () => {
    const { layer, meshes } = runLayer("fire", fire, { rollS: 0.5 });
    const m = meshes[0]?.material as MeshStandardMaterial;
    expect(m.emissiveIntensity).toBeGreaterThan(0);
    // A miniature: cleared right at rest.
    layer.clear();
    expect(m.emissiveIntensity).toBe(0);
    expect(layer.active()).toBe(false);
    const pop = runLayer("slashing", popKind([]), { rollS: 0.5 });
    expect(pop.layer.object.children.length).toBeGreaterThan(0);
  });

  test("FR-DICEX-106 one atlas: core tiles, then the kinds'; a shared name is one sprite", () => {
    const skull = () => {};
    const other = () => {};
    const layout = atlasLayout([
      { skull, bubble: other },
      { skull: other, fume: other },
    ]);
    expect([...layout.index.keys()]).toEqual([
      ...Object.keys(CORE_TILES),
      "skull",
      "bubble",
      "fume",
    ]);
    expect(layout.draws[layout.index.get("skull") as number]).toBe(skull);
    expect(layout.grid * layout.grid).toBeGreaterThanOrEqual(layout.draws.length);
    expect(Math.log2(layout.grid) % 1).toBe(0);
  });

  test("FR-DICEX-106 every built kind keeps the rules: sprites, ranges, budget, landing", () => {
    expect(built.length).toBeGreaterThanOrEqual(2);
    for (const [, def] of built) {
      const { species, emitters } = def.preset;
      for (const s of species) {
        expect(Object.hasOwn(CORE_TILES, s.tile) || Object.hasOwn(def.tiles ?? {}, s.tile)).toBe(
          true,
        );
        for (let t = 0; t <= 1; t += 0.05) {
          for (const c of rampAt(s.ramp, t)) {
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1);
          }
        }
      }
      for (const e of emitters) expect(e.species).toBeLessThan(species.length);
      if (def.aura) expect(def.aura.frag).toContain("uniform float uAmp");
      // Many dice, two bursts: never over the cap; the same seed sheds the same particles.
      const a = richSim(def.preset, 20, 5, def.whileRolling);
      const b = richSim(def.preset, 20, 5, def.whileRolling);
      const dice = fly(a, 20, 0.6);
      fly(b, 20, 0.6);
      a.burst(dice);
      a.burst(dice);
      expect(a.count).toBeLessThanOrEqual(MAX_PARTICLES);
      b.burst(dice);
      if (b.count > 0) expect(b.drawn(0, 1)).toEqual(a.drawn(0, 1));
      if (!def.whileRolling) {
        const still = richSim(def.preset, 1, 1, false);
        fly(still, 1, 0.5);
        expect(still.count).toBe(0);
      }
      expect(landFade(LAND_CLOCK_S)).toBe(0);
    }
  });
});
