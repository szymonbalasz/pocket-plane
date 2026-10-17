// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// FR-MOD-53 / -54 trigger state (MOD §13.1, ADR-0049): one `trigger-state` row per (enabled
// trigger, owner combatant) of the started encounter, rewritten in the causing transaction on
// every path and listed in the causing event's `changes`: Brakka's Divine Fury through the turn
// (waiting / ready / used), apply / undo, Next / Prev, Rage via the effect hooks, out of combat,
// owner reassignment, remove / restore, End; trigger and preset commands; a `roll` trigger spent
// at once; a monster's row.
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { MOD_INTENTS } from "@shared/effect-modifiers/intents";
import { TRIGGER_INTENTS } from "@shared/effect-modifiers/trigger-intents";
import {
  TRIGGER_STATE_TYPE,
  type TriggerStateRecord,
  triggerCharge,
} from "@shared/effect-modifiers/trigger-state";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { asc } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { triggerState } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { applyCard, undoCommand } from "../combat-tracker/hp";
import { setRemoved } from "../combat-tracker/initiative";
import { divineFury, type RtSetup, rtSetup } from "./trigger-testing";

const rows = (t: RtSetup) =>
  t.s.db
    .select()
    .from(triggerState)
    .orderBy(asc(triggerState.combatantId))
    .all() as TriggerStateRecord[];
const furyRow = (t: RtSetup) => rows(t).find((r) => r.triggerId === t.furyId);
/** The `trigger-state` changes of the last event of a type. */
const stateChanges = (t: RtSetup, type: string): RecordChange[] =>
  t.events
    .findLast((e) => e.event.type === type)
    ?.event.changes.filter((c) => c.type === TRIGGER_STATE_TYPE) ?? [];
const charges = (cs: RecordChange[]) =>
  cs.map((c) => (c.after as TriggerStateRecord | null)?.charge ?? "deleted");
const assignFury = (t: RtSetup) => [{ triggerId: t.furyId }];
const viewer = (t: RtSetup, playerId: string): Viewer => ({
  connId: "c",
  campaignId: t.h.dm.campaignId as string,
  role: "player",
  playerId,
});

describe("FR-MOD-53/54 state follows the turn", () => {
  test("FR-MOD-53/54 state follows the turn: waiting → armed → ready → used → undo → ready; Next / Prev windows; Rage ended → not armed; out of combat nothing; reassignment; remove / restore; End deletes", () => {
    const t = rtSetup();
    // Added in round 1 on the Wolf's turn: Divine Fury needs Rage and Brakka's turn.
    expect(furyRow(t)).toMatchObject({
      combatantId: t.id("Brakka"),
      characterId: t.brakkaId,
      ownerPlayerId: t.h.p1.id,
      name: "Divine Fury",
      on: "hit",
      armed: false,
      charge: "waiting",
      featureId: null,
    });
    expect(stateChanges(t, "CombatantsAdded")).toHaveLength(1);

    // Rage on (player-1) → armed, through CBTX's effect hooks; listed in `EffectToggled`.
    t.rage(true);
    expect(furyRow(t)).toMatchObject({ armed: true, charge: "waiting" });
    expect(
      stateChanges(t, "EffectToggled").map((c) => (c.after as TriggerStateRecord).armed),
    ).toEqual([true]);

    // Next to Brakka → ready (only her row changes; listed in `TurnChanged`).
    t.nextTo("Brakka", 1);
    expect(furyRow(t)?.charge).toBe("ready");
    expect(charges(stateChanges(t, "TurnChanged"))).toEqual(["ready"]);

    // Apply with Divine Fury → used; undo → ready; re-apply → used.
    const { cardId } = t.attack("Brakka");
    expect(furyRow(t)?.charge).toBe("ready");
    t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t) }]);
    expect(furyRow(t)?.charge).toBe("used");
    expect(charges(stateChanges(t, "AttackApplied"))).toEqual(["used"]);
    t.undo();
    expect(furyRow(t)?.charge).toBe("ready");
    expect(charges(stateChanges(t, "CombatEntryUndone"))).toEqual(["ready"]);
    t.applyTo(cardId, [{ name: "Goblin 2", triggers: assignFury(t) }]);
    expect(furyRow(t)?.charge).toBe("used");

    // Next → another creature's turn → waiting; Prev into the used turn → used again.
    t.step("next");
    expect(furyRow(t)?.charge).toBe("waiting");
    t.step("prev");
    expect(furyRow(t)?.charge).toBe("used");
    expect(charges(stateChanges(t, "TurnChanged"))).toEqual(["used"]);
    // Her next turn: a new window → ready.
    t.nextTo("Brakka", 2);
    expect(furyRow(t)?.charge).toBe("ready");
    // A Next that doesn't touch her row lists no state change.
    t.step("next");
    t.step("next");
    expect(stateChanges(t, "TurnChanged")).toEqual([]);

    // Rage ended by the DM (CBTX `cbtx.endEffect`) → not armed, via the effect hooks.
    const rage = t.active().find((e) => e.label === "Rage");
    t.end(rage?.id as string);
    expect(furyRow(t)?.armed).toBe(false);
    expect(stateChanges(t, "EffectsEnded")).toHaveLength(1);

    // Owner reassignment: player-1 gets the delete, player-2 the row.
    t.run("char.edit", { creatureId: t.brakkaId, set: { ownerPlayerId: t.h.p2.id } });
    expect(furyRow(t)?.ownerPlayerId).toBe(t.h.p2.id);
    const moved = stateChanges(t, "CharacterSheetEdited");
    expect(moved).toHaveLength(1);
    const wire = (pid: string) =>
      t.s.records.filterChange(moved[0] as RecordChange, viewer(t, pid));
    expect(wire(t.h.p1.id)?.op).toBe("delete");
    expect(wire(t.h.p2.id)?.op).toBe("upsert");

    // Remove / restore the combatant: rows unchanged.
    const before = rows(t);
    t.run(setRemoved.name, { combatantId: t.id("Brakka"), removed: true });
    t.run(setRemoved.name, { combatantId: t.id("Brakka"), removed: false });
    expect(rows(t)).toEqual(before);

    // End → every row deleted, listed in `EncounterEnded`.
    const n = rows(t).length;
    t.endEncounter();
    expect(rows(t)).toEqual([]);
    expect(charges(stateChanges(t, "EncounterEnded"))).toEqual(Array(n).fill("deleted"));

    // Out of combat: Rage toggled → no row written, none listed.
    t.rage(true, t.h.dm);
    expect(rows(t)).toEqual([]);
    expect(stateChanges(t, "EffectToggled")).toEqual([]);
  });

  test("FR-MOD-54 trigger commands: disable deletes the row, enable re-creates it, rename rewrites it, delete lists it; unchanged triggers write nothing", () => {
    const t = rtSetup();
    const put = (patch: { enabled?: boolean; name?: string }) =>
      t.trig({
        id: t.furyId,
        characterId: t.brakkaId,
        name: patch.name ?? "Divine Fury",
        enabled: patch.enabled ?? true,
        rule: divineFury(t.ragePresetId),
      });
    put({ enabled: false });
    expect(furyRow(t)).toBeUndefined();
    expect(charges(stateChanges(t, "RuleTriggerSaved"))).toEqual(["deleted"]);
    put({});
    expect(furyRow(t)).toMatchObject({ armed: false, charge: "waiting" });
    put({ name: "Zealous Fury" });
    expect(furyRow(t)?.name).toBe("Zealous Fury");
    expect(stateChanges(t, "RuleTriggerSaved")).toHaveLength(1);
    put({ name: "Zealous Fury" });
    expect(stateChanges(t, "RuleTriggerSaved")).toEqual([]);
    const id = furyRow(t)?.id;
    t.run(TRIGGER_INTENTS.deleteTrigger, { triggerId: t.furyId });
    expect(rows(t)).toEqual([]);
    expect(stateChanges(t, "RuleTriggerDeleted").map((c) => [c.id, c.after])).toEqual([[id, null]]);
  });

  test("FR-MOD-54 presets: a trigger requiring built-in `rage` is armed through a preset's origin key; deleting that preset disarms it", () => {
    const t = rtSetup();
    // Divine Fury now requires the built-in key; Brakka's preset carries `originKey: rage`.
    t.trig({
      id: t.furyId,
      characterId: t.brakkaId,
      name: "Divine Fury",
      rule: divineFury("rage"),
    });
    t.rage(true);
    expect(furyRow(t)?.armed).toBe(true);
    t.run(MOD_INTENTS.deletePreset, { presetId: t.ragePresetId });
    expect(furyRow(t)?.armed).toBe(false);
    expect(stateChanges(t, "EffectPresetDeleted")).toHaveLength(1);
  });

  test("FR-MOD-54 roll trigger spent at once: its row turns used, listed in the roll's event; a monster's row has no owner copies", () => {
    const t = rtSetup();
    const rule: TriggerRule = {
      on: "roll",
      when: [{ if: "roll", on: { roll: "damage", via: "weapon" } }],
      every: "turn",
      then: { do: "part", formula: "2" },
    };
    const id = t.trig({ characterId: t.brakkaId, name: "Steady Hand", rule });
    const row = () => rows(t).find((r) => r.triggerId === id);
    expect(row()?.charge).toBe("ready");
    t.roll(
      { creature: { characterId: t.brakkaId }, roll: "damage", via: "weapon" },
      { expression: "1d12+4", actorName: "Brakka" },
    );
    expect(row()?.charge).toBe("used");
    expect(charges(stateChanges(t, "DiceRolled"))).toEqual(["used"]);
    t.step("next");
    expect(row()?.charge).toBe("ready");

    t.trig({ definitionId: t.h.wolfId, name: "Pack Tactics", rule });
    const wolf = rows(t).find((r) => r.combatantId === t.id("Wolf"));
    expect(wolf).toMatchObject({ characterId: null, ownerPlayerId: null, armed: true });
  });

  test("FR-MOD-53 charge: waiting while ownTurn fails (even when used); used only for windowed triggers", () => {
    const own = { when: [{ if: "ownTurn" }], every: "turn" as const };
    expect(triggerCharge(own, { ownTurn: false, used: true })).toBe("waiting");
    expect(triggerCharge(own, { ownTurn: true, used: true })).toBe("used");
    expect(triggerCharge(own, { ownTurn: true, used: false })).toBe("ready");
    expect(triggerCharge({ when: [], every: "each" }, { ownTurn: false, used: true })).toBe(
      "ready",
    );
    expect(
      triggerCharge({ when: [], every: { feature: "f" } }, { ownTurn: true, used: true }),
    ).toBe("ready");
    expect(triggerCharge({ when: [], every: "round" }, { ownTurn: false, used: true })).toBe(
      "used",
    );
  });
});

describe("FR-MOD-54 effect hooks", () => {
  test("FR-MOD-54 CBTX effect add on Brakka arms nothing it doesn't require; a creature outside the encounter writes nothing", () => {
    const t = rtSetup();
    t.run(CBTX_INTENTS.addEffect, {
      targets: [{ characterId: t.brakkaId }],
      kind: "condition",
      condition: "prone",
    });
    expect(stateChanges(t, "EffectsAdded")).toEqual([]);
    expect(furyRow(t)?.armed).toBe(false);
  });
});

describe("FR-MOD-51 crash safety (trigger state)", () => {
  test("FR-MOD-51 hard kill: cbt.applyCard before-commit → state still ready; after-commit → used with the use row; cbt.undo before-commit → still used", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = rtSetup();
    t.nextTo("Brakka", 1);
    t.rage(true);
    const { cardId } = t.attack("Brakka");
    try {
      armCrashHook({ point: "before-commit", target: applyCard.name }, kill);
      expect(() => t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t) }])).toThrow();
      expect(furyRow(t)?.charge).toBe("ready");
      armCrashHook({ point: "after-commit", target: applyCard.name }, kill);
      expect(() => t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t) }])).toThrow(
        Killed,
      );
      expect(furyRow(t)?.charge).toBe("used");
      expect(t.usesOf(t.furyId).map((u) => u.state)).toEqual(["used"]);
      armCrashHook({ point: "before-commit", target: undoCommand.name }, kill);
      expect(() => t.undo()).toThrow();
      expect(furyRow(t)?.charge).toBe("used");
    } finally {
      armCrashHook(null);
    }
  });
});
