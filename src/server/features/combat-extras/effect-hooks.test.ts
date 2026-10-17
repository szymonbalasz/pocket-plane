// FR-CBTX-51 effect-changed hooks (ADR-0049 D2, seams S6): `effectHooks` runs once per command
// (per target event of an apply) after the effect rows are written, in its transaction, in and
// out of combat, on every CBTX path that inserts, updates, ends or restores effects; its rows
// join the causing event; a throwing line rolls the command back; no effect change → no run.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TargetRef } from "@shared/combat-extras/intents";
import type { DispatchedEvent } from "../../events/types";
import { rollConcentration } from "./concentration";
import { updateEffect } from "./effect-commands";
import { type EffectsChanged, effectsChangedHooks } from "./effect-hooks";
import { cbtxSetup } from "./testing";

const PROBE = "test-effect-probe";
let calls: EffectsChanged[] = [];
let fail = false;
beforeEach(() => {
  calls = [];
  fail = false;
  effectsChangedHooks.register({
    id: "test.effects-changed",
    effectsChanged(_env, d) {
      if (fail) throw new Error("hook failed");
      calls.push(d);
      return [
        { type: PROBE, id: `probe-${calls.length}`, before: null, after: { n: calls.length } },
      ];
    },
  });
});
afterEach(() => effectsChangedHooks.unregister("test.effects-changed"));

/** The events since `n` that carry a probe row, by type. */
const probed = (events: readonly DispatchedEvent[], n: number) =>
  events
    .slice(n)
    .filter((e) => e.event.changes.some((c) => c.type === PROBE))
    .map((e) => e.event.type);

describe("FR-CBTX-51 effect hooks", () => {
  test("FR-CBTX-51 effect hooks run once per command, in and out of combat: addEffect on 3 targets → one call with 3 creatures", () => {
    const t = cbtxSetup();
    const n = t.events.length;
    t.add({
      targets: [
        { combatantId: t.id("Goblin") },
        { combatantId: t.id("Goblin 2") },
        { combatantId: t.id("Thorn") },
      ],
      kind: "condition",
      condition: "frightened",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.creatures).toEqual([
      { combatantId: t.id("Goblin") },
      { combatantId: t.id("Goblin 2") },
      { characterId: t.thornId },
    ] satisfies TargetRef[]);
    expect(calls[0]?.encounter?.id).toBe(t.enc.id);
    expect(probed(t.events, n)).toEqual(["EffectsAdded"]);
    // Everything skipped (already frightened) → no event, no run.
    t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "condition",
      condition: "frightened",
    });
    expect(calls).toHaveLength(1);
  });

  test("FR-CBTX-51 update, end, concentration (replaced + linked ends), incapacitating condition: one call each, each creature once", () => {
    const t = cbtxSetup();
    const [prone] = t.add({
      targets: [{ combatantId: t.id("Wolf") }],
      kind: "condition",
      condition: "prone",
    }).effectIds as [string];
    t.run(updateEffect.name, { effectId: prone, durationRounds: 2 });
    t.end(prone);
    const conc = t.concentrate({ characterId: t.miraId }, "Bless");
    t.add({
      targets: [{ combatantId: t.id("Thorn") }],
      kind: "custom",
      label: "Bless",
      sourceCombatantId: t.id("Mira"),
      linkConcentration: true,
    });
    calls = [];
    const n = t.events.length;
    // Replacing ends the old one and its Thorn link: Mira and Thorn, once each.
    t.concentrate({ characterId: t.miraId }, "Hold Person");
    expect(calls.map((c) => c.creatures)).toEqual([
      [{ characterId: t.miraId }, { characterId: t.thornId }],
    ]);
    expect(t.fx(conc).endedReason).toBe("replaced");
    // Stunned on Mira ends her concentration: one call, Mira once.
    t.add({ targets: [{ characterId: t.miraId }], kind: "condition", condition: "stunned" });
    expect(calls.slice(1).map((c) => c.creatures)).toEqual([[{ characterId: t.miraId }]]);
    expect(probed(t.events, n)).toEqual(["ConcentrationSet", "EffectsAdded"]);
    expect(calls).toHaveLength(2);
  });

  test("FR-CBTX-51 0 HP concentration end inside an apply → called with that target; undo restore → called; an apply that ends nothing → not", () => {
    const t = cbtxSetup();
    t.concentrate({ characterId: t.miraId }, "Bless");
    calls = [];
    const n = t.events.length;
    // Mira at 1 HP (a concentration card, nothing ends), then a hit to 0 inside the apply.
    t.hp("Mira", "damage", t.character(t.miraId).hpCurrent - 1);
    t.attackApply("Goblin", ["Goblin 2"], 3);
    expect(calls).toHaveLength(0);
    t.attackApply("Goblin", ["Mira"], 3);
    expect(calls.map((c) => c.creatures)).toEqual([[{ characterId: t.miraId }]]);
    expect(calls[0]?.encounter?.id).toBe(t.enc.id);
    expect(probed(t.events, n)).toEqual(["AttackApplied"]);
    const m = t.events.length;
    t.undo();
    expect(calls.map((c) => c.creatures)).toEqual([
      [{ characterId: t.miraId }],
      [{ characterId: t.miraId }],
    ]);
    expect(probed(t.events, m)).toEqual(["CombatEntryUndone"]);
  });

  test("FR-CBTX-51 a failed concentration save → called", () => {
    const t = cbtxSetup();
    t.concentrate({ characterId: t.miraId }, "Bless");
    t.attackApply("Goblin", ["Mira"], 3);
    const [card] = t.cards();
    calls = [];
    const r = t.run<{ success: boolean }>(
      rollConcentration.name,
      { notificationId: card?.id, manual: { diceTotal: 1 } },
      t.p1,
    );
    expect(r.success).toBe(false);
    expect(calls.map((c) => c.creatures)).toEqual([[{ characterId: t.miraId }]]);
  });

  test("FR-CBTX-51 Next expiry and Prev restore → called with the expired / restored creatures; End → called", () => {
    const t = cbtxSetup();
    t.add({
      targets: [{ combatantId: t.id("Goblin") }],
      kind: "condition",
      condition: "poisoned",
      durationRounds: 1,
    });
    calls = [];
    // Due at the start of the anchor's (the Wolf's, the turn combatant) turn in round 2.
    t.nextTo("Elite Goblin Warrior", 1);
    expect(calls).toHaveLength(0);
    const n = t.events.length;
    t.step("next");
    expect(calls.map((c) => c.creatures)).toEqual([[{ combatantId: t.id("Goblin") }]]);
    expect(probed(t.events, n)).toEqual(["TurnChanged"]);
    t.step("prev");
    expect(calls.map((c) => c.creatures)).toEqual([
      [{ combatantId: t.id("Goblin") }],
      [{ combatantId: t.id("Goblin") }],
    ]);
    expect(t.active().some((e) => e.condition === "poisoned")).toBe(true);
    calls = [];
    const m = t.events.length;
    t.endEncounter();
    expect(calls.map((c) => c.creatures)).toEqual([[{ combatantId: t.id("Goblin") }]]);
    expect(calls[0]?.encounter).toMatchObject({ id: t.enc.id, status: "ended" });
    expect(probed(t.events, m)).toEqual(["EncounterEnded"]);
  });

  test("FR-CBTX-51 out of combat: cbtx.addEffect on a character → called with encounter null", () => {
    const t = cbtxSetup();
    t.endEncounter();
    calls = [];
    t.add({ targets: [{ characterId: t.miraId }], kind: "custom", label: "Blessed" });
    expect(calls).toEqual([{ creatures: [{ characterId: t.miraId }], encounter: null }]);
  });

  test("FR-CBTX-51 a throwing line rolls the command back", () => {
    const t = cbtxSetup();
    const before = t.effects().length;
    const n = t.events.length;
    fail = true;
    const e = t.err(() =>
      t.add({ targets: [{ combatantId: t.id("Wolf") }], kind: "condition", condition: "prone" }),
    );
    expect(e.code).toBe("internal");
    expect(t.effects()).toHaveLength(before);
    expect(t.events.length).toBe(n);
  });
});
