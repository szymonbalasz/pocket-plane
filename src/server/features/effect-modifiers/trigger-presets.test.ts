// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// R5 (MOD §13 integration, presets): built-in trigger presets through "Start from" and
// `addTriggerFromPreset`; Hunter's Mark as a mark on the hunted creature + the ranger's trigger
// (OQ-MOD-27); 0-modifier campaign marks (FR-MOD-05, #209); `roll` triggers with `every: feature`
// rejected at save (#223); `roll`-trigger parts from a physical `t:` group (#224).
import { describe, expect, test } from "bun:test";
import type { ManualPart } from "@shared/dice-roll-log/schemas";
import { CHARACTER_PRESET_EMPTY, type RollSubject } from "@shared/effect-modifiers/schemas";
import { targetMarkedBy } from "@shared/effect-modifiers/trigger-fire";
import { startFromTriggerPreset } from "@shared/effect-modifiers/trigger-presets";
import { ROLL_FEATURE_UNSUPPORTED, type TriggerRule } from "@shared/effect-modifiers/triggers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { seededContext } from "../../commands/context";
import { CommandError } from "../../commands/errors";
import { effect, ruleTrigger } from "../../db/schema";
import { dice, type EvaluatedRoll } from "../dice-roll-log";
import { addTriggerFromPreset } from "./index";
import { type RtSetup, rtSetup } from "./trigger-testing";

/** A stand-in physical damage roll with `manualParts` (R2's tray sends them on real intents). */
const physicalDamage = defineCommand({
  name: "test.r5PhysicalDamage",
  input: z.object({ subject: z.unknown(), manualParts: z.unknown().optional() }),
  roles: ["dm", "player"],
  execute(input, env) {
    return dice.evaluate(env, {
      expression: "1d12+4",
      mode: "normal",
      category: "damage",
      label: "Greataxe damage",
      actor: { kind: "entity", id: "x", name: "Brakka" },
      source: "char",
      subject: input.subject as RollSubject,
      manual: { diceTotal: 8, dice: [8] },
      ...(input.manualParts ? { manualParts: input.manualParts as ManualPart[] } : {}),
    });
  },
});

const failure = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof CommandError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected a CommandError");
};

/** Thorn's trigger "Start from" a built-in, saved by the owner (player-2). */
const startFrom = (t: RtSetup, key: string) => {
  const s = startFromTriggerPreset(key, { kind: "character", id: t.thornId });
  if (!s) throw new Error(`no start-from ${key}`);
  return t.trig(s.draft, t.p2);
};

/** Effect rows on the board now (DM view) for the target-side mark check. */
const effects = (t: RtSetup) => t.s.db.select().from(effect).all();

describe("FR-MOD-46 Start from (built-in trigger presets)", () => {
  test("FR-MOD-46 Start from: the owner saves Sneak Attack, the DM Martial Advantage / Regeneration on definitions; defaults kept", () => {
    const t = rtSetup();
    const sa = startFrom(t, "sneak-attack");
    const def = (key: string) => {
      const s = startFromTriggerPreset(key, { kind: "definition", id: t.h.wolfId });
      if (!s) throw new Error(key);
      return t.trig(s.draft);
    };
    const ma = def("martial-advantage");
    const regen = def("regeneration");
    const row = (id: string) =>
      t.s.db.select().from(ruleTrigger).where(eq(ruleTrigger.id, id)).get();
    expect([row(sa)?.name, row(sa)?.public, row(sa)?.characterId]).toEqual([
      "Sneak Attack",
      true,
      t.thornId,
    ]);
    expect([row(ma)?.name, row(ma)?.public, row(ma)?.definitionId]).toEqual([
      "Martial Advantage",
      false,
      t.h.wolfId,
    ]);
    expect(row(regen)?.rule.on).toBe("turnStart");
    // A monster built-in can't start a character's trigger from the editor.
    expect(startFromTriggerPreset("martial-advantage", { kind: "character", id: t.thornId })).toBe(
      undefined,
    );
  });
});

describe("FR-MOD-05 Hunter's Mark: a mark on the hunted creature + the ranger's trigger (OQ-MOD-27)", () => {
  test("FR-MOD-05 the built-in mark applies with 0 modifiers; Thorn's Hunter's Mark trigger is offered marked, the mark holds on Goblin only; apply lands it", () => {
    const t = rtSetup();
    const hm = startFrom(t, "hunters-mark");
    t.apply({
      targets: [{ combatantId: t.id("Goblin") }],
      preset: { key: "hunters-mark" },
      sourceCombatantId: t.id("Thorn"),
    });
    const mark = effects(t).find((e) => e.presetKey === "hunters-mark");
    expect([mark?.label, mark?.modifiers, mark?.targetCombatantId]).toEqual([
      "Hunter's Mark",
      [],
      t.id("Goblin"),
    ]);
    const { cardId } = t.attack("Thorn", { damage: 3 });
    const p = t.card(cardId);
    // The mark adds nothing to the roll itself: only the trigger's offered d6.
    expect(p.damage?.mods ?? []).toEqual([]);
    expect(p.damage?.triggers?.map((x) => [x.triggerId, x.expression, x.marked])).toEqual([
      [hm, "1d6", "hunters-mark"],
    ]);
    const on = (name: string) =>
      targetMarkedBy(effects(t), { combatantId: t.id(name) }, "hunters-mark", t.id("Thorn"));
    expect([on("Goblin"), on("Goblin 2")]).toEqual([true, false]);
    // Another attacker's offer would not be marked by Thorn's effect.
    expect(
      targetMarkedBy(effects(t), { combatantId: t.id("Goblin") }, "hunters-mark", t.id("Mira")),
    ).toBe(false);
    const before = t.s.db.select().from(effect).all().length;
    t.applyTo(cardId, [{ name: "Goblin", triggers: [{ triggerId: hm }] }]);
    expect(t.usesOf(hm).map((u) => [u.state, u.targetId])).toEqual([["used", t.id("Goblin")]]);
    expect(t.s.db.select().from(effect).all()).toHaveLength(before);
  });
});

describe("FR-MOD-05 campaign marks (#209)", () => {
  const favoredFoe = (mark: string): TriggerRule => ({
    on: "hit",
    when: [
      { if: "via", via: "weapon" },
      { if: "targetMarked", preset: mark },
    ],
    every: "turn",
    then: { do: "damage", formula: "1d(4 + 2 * steps(level(ranger), 6, 14))", type: null },
  });

  test("FR-MOD-05 campaign mark: DM saves a 0-modifier campaign preset, applies it to Goblin with Thorn as source → Thorn's targetMarked offer holds on Goblin, not Goblin 2", () => {
    const t = rtSetup();
    const mark = t.put({
      characterId: null,
      name: "Favored Foe",
      modifiers: [],
      durationRounds: 10,
      concentration: true,
      note: "",
    });
    expect(t.preset(mark).modifiers).toEqual([]);
    const ff = t.trig({ characterId: t.thornId, name: "Favored Foe", rule: favoredFoe(mark) });
    t.apply({
      targets: [{ combatantId: t.id("Goblin") }],
      preset: { presetId: mark },
      sourceCombatantId: t.id("Thorn"),
    });
    t.nextTo("Thorn", 1);
    const { cardId } = t.attack("Thorn", { damage: 3 });
    const offer = t.card(cardId).damage?.triggers?.[0];
    expect([offer?.triggerId, offer?.marked, offer?.expression]).toEqual([
      ff,
      "Favored Foe",
      "1d4",
    ]);
    const on = (name: string) =>
      targetMarkedBy(effects(t), { combatantId: t.id(name) }, mark, t.id("Thorn"));
    expect([on("Goblin"), on("Goblin 2")]).toEqual([true, false]);
    t.applyTo(cardId, [{ name: "Goblin", triggers: [{ triggerId: ff }] }]);
    expect(t.usesOf(ff).map((u) => u.state)).toEqual(["used"]);
  });

  test("FR-MOD-05 a 0-modifier character preset → invalid; a player can't save a campaign mark", () => {
    const t = rtSetup();
    const empty = {
      name: "Mark",
      modifiers: [],
      durationRounds: null,
      concentration: false,
      note: "",
    };
    expect(failure(() => t.put({ ...empty, characterId: t.thornId }, t.p2))).toEqual({
      code: "invalid",
      message: expect.any(String),
    });
    expect(failure(() => t.put({ ...empty, characterId: t.thornId }))).toMatchObject({
      code: "invalid",
    });
    const issues = (() => {
      try {
        t.put({ ...empty, characterId: t.thornId });
      } catch (e) {
        return (e as CommandError).issues?.map((i) => i.message);
      }
    })();
    expect(issues).toContain(CHARACTER_PRESET_EMPTY);
    expect(failure(() => t.put({ ...empty, characterId: null }, t.p2)).code).toBe("forbidden");
    // Customising the built-in mark keeps it a 0-modifier campaign preset.
    const custom = t.put({ ...empty, characterId: null, key: "hunters-mark", name: "Quarry" });
    expect(t.preset(custom)).toMatchObject({ key: "hunters-mark", modifiers: [] });
  });
});

describe("FR-MOD-43 roll triggers (R5)", () => {
  const rollPart = (every: TriggerRule["every"]): TriggerRule => ({
    on: "roll",
    when: [{ if: "roll", on: { roll: "damage", via: "weapon" } }],
    every,
    then: { do: "part", formula: "1d4 + 1" },
  });

  test("FR-MOD-43 a roll trigger with every: feature → invalid at save (documented limitation #223), also via addTriggerFromPreset", () => {
    const t = rtSetup();
    const put = () =>
      t.trig({
        characterId: t.brakkaId,
        name: "Frenzy",
        rule: rollPart({ feature: t.rageRowId }),
      });
    const e = failure(put);
    expect(e.code).toBe("invalid");
    const issues = (() => {
      try {
        put();
      } catch (err) {
        return (err as CommandError).issues?.map((i) => [i.path.join("."), i.message]);
      }
    })();
    expect(issues).toContainEqual(["trigger.rule.every", ROLL_FEATURE_UNSUPPORTED]);
    const viaHelper = failure(() =>
      t.s.db.transaction((tx) =>
        addTriggerFromPreset(
          {
            tx,
            actor: t.h.dm,
            ctx: seededContext({ disposable: true, key: "r5" }),
            emit: () => {},
          },
          t.brakkaId,
          { name: "Frenzy", rule: rollPart({ feature: t.rageRowId }) },
        ),
      ),
    );
    expect(viaHelper.code).toBe("invalid");
    expect(
      t.s.db
        .select()
        .from(ruleTrigger)
        .all()
        .map((r) => r.name),
    ).toEqual(["Divine Fury"]);
  });

  test("FR-MOD-18 a roll trigger's part from a physical `t:` group (not auto); none → server-rolled, auto; an unfit group never conflicts", () => {
    const t = rtSetup({ inCombat: false });
    t.s.commands.register(physicalDamage);
    const id = t.trig({ characterId: t.brakkaId, name: "Savage", rule: rollPart("each") });
    const roll = (manualParts?: unknown) =>
      t.s.commands.run(
        physicalDamage.name,
        {
          subject: { creature: { characterId: t.brakkaId }, roll: "damage", via: "weapon" },
          manualParts,
        },
        { actor: t.p1 },
      ) as EvaluatedRoll;
    const r = roll([{ key: `t:${id}`, entry: { diceTotal: 3, dice: [3] } }]);
    expect(r.mods?.parts.map((p) => [p.triggerId, p.value, p.expression, p.dice, p.auto])).toEqual([
      [id, 4, "1d4+1", [3], undefined],
    ]);
    expect(r.mods?.modTotal).toBe(4);
    expect(roll().mods?.parts[0]?.auto).toBe(true);
    const unfit = roll([{ key: `t:${id}`, entry: { diceTotal: 9, dice: [9] } }]);
    expect(unfit.mods?.parts[0]?.auto).toBe(true);
  });
});
