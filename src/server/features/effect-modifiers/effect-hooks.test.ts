// FR-MOD-54 / FR-CBTX-51 (S4-0 wiring): MOD's effect commands reach CBTX's `effectHooks` through
// CBTX's insert / end / update helpers: `mod.apply`, `mod.toggle` (on and off, in and out of
// combat), `mod.setModifiers` each run the hooks once, their rows join the MOD event.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import type { DispatchedEvent } from "../../events/types";
import { type EffectsChanged, effectsChangedHooks } from "../combat-extras/effect-hooks";
import { rtSetup } from "./trigger-testing";

const PROBE = "test-effect-probe";
let calls: EffectsChanged[] = [];
beforeEach(() => {
  calls = [];
  effectsChangedHooks.register({
    id: "test.mod-effects-changed",
    effectsChanged(_env, d) {
      calls.push(d);
      return [{ type: PROBE, id: `probe-${calls.length}`, before: null, after: {} }];
    },
  });
});
afterEach(() => effectsChangedHooks.unregister("test.mod-effects-changed"));

const probed = (events: readonly DispatchedEvent[], n: number) =>
  events
    .slice(n)
    .filter((e) => e.event.changes.some((c) => c.type === PROBE))
    .map((e) => e.event.type);

describe("FR-MOD-54 MOD commands through CBTX's effect helpers", () => {
  test("FR-MOD-54 mod.apply (concentration started), mod.setModifiers: one effectsChanged each", () => {
    const t = rtSetup();
    const n = t.events.length;
    const r = t.bless();
    expect(calls.map((c) => c.creatures)).toEqual([
      [{ characterId: t.miraId }, { characterId: t.thornId }],
    ]);
    expect(calls[0]?.encounter?.id).toBe(t.enc.id);
    t.run(MOD_INTENTS.setModifiers, {
      effectId: r.effectIds[1] as string,
      modifiers: [{ kind: "flat", on: { roll: "attack" }, value: 1 }],
    });
    expect(calls.slice(1).map((c) => c.creatures)).toEqual([[{ characterId: t.thornId }]]);
    expect(probed(t.events, n)).toEqual(["PresetApplied", "EffectModifiersSet"]);
  });

  test("FR-MOD-54 mod.toggle on / off in combat and out of combat (encounter null)", () => {
    const t = rtSetup();
    const n = t.events.length;
    t.rage(true);
    t.rage(false);
    expect(calls.map((c) => [c.creatures, c.encounter?.id ?? null])).toEqual([
      [[{ characterId: t.brakkaId }], t.enc.id],
      [[{ characterId: t.brakkaId }], t.enc.id],
    ]);
    expect(probed(t.events, n)).toEqual(["EffectToggled", "EffectToggled"]);
    t.endEncounter();
    calls = [];
    t.rage(true);
    expect(calls).toEqual([{ creatures: [{ characterId: t.brakkaId }], encounter: null }]);
    // Already on → no event, no run.
    t.rage(true);
    expect(calls).toHaveLength(1);
  });
});
