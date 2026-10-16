// FR-MOD-18 (R2): every roll intent carries `manualParts` to `dice.evaluate` — `char.roll`,
// `cbt.attack` (one list per `manual` entry), `cbt.rollDamage`, `cbt.rollAbility`,
// `cbt.rollInitiative`, `cbtx.rollConcentration`, `cbtx.rollDeathSave`. `e:` groups are strict
// (FR-MOD-18; R1's `evaluate.ts`), `t:` groups never conflict.
import { describe, expect, test } from "bun:test";
import type { AttackResult, DamageCardPayload } from "@shared/combat-tracker/schemas";
import {
  MANUAL_PARTS_ALONE,
  MANUAL_PARTS_PER_ENTRY,
  type ManualPart,
  type RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import { bonusDieKey } from "@shared/effect-modifiers/rules";
import { eq } from "drizzle-orm";
import { gameLogEntry, roll } from "../../db/schema";
import { EFFECTS_CHANGED } from "../dice-roll-log/evaluate";
import { type ModSetup, modSetup } from "./testing";

const items = (t: ModSetup, entryId: string) =>
  t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, entryId)).get()
    ?.payload as RollEntryPayload;
const rollRow = (t: ModSetup, id: string) =>
  t.s.db.select().from(roll).where(eq(roll.id, id)).get();
/** The active custom effect `label` on a character / combatant. */
const effectId = (t: ModSetup, label: string, on: { characterId?: string; combatantId?: string }) =>
  t
    .active()
    .find(
      (e) =>
        e.kind === "custom" &&
        e.label === label &&
        (on.characterId
          ? e.targetCharacterId === on.characterId
          : e.targetCombatantId === on.combatantId),
    )?.id as string;
const part = (key: string, diceTotal: number): ManualPart => ({ key, entry: { diceTotal } });

/** A campaign preset with one bonus die, applied to `target`. */
function diceEffect(
  t: ModSetup,
  name: string,
  on: { roll: "damage" | "initiative" | "save"; via?: "weapon" },
  target: { characterId: string } | { combatantId: string },
  dice = "1d6",
) {
  const presetId = t.put({
    characterId: null,
    name,
    modifiers: [{ kind: "dice", on, dice, sign: 1 }],
    durationRounds: null,
    concentration: false,
  });
  t.apply({ targets: [target], preset: { presetId } });
  return effectId(t, name, target);
}

describe("FR-MOD-18 manualParts on two-roll intents (one list per manual entry)", () => {
  test("FR-MOD-18 char.roll attack: Bless's group on the to-hit → physical part; damage list empty", () => {
    const t = modSetup();
    t.bless();
    const key = bonusDieKey(effectId(t, "Bless", { characterId: t.miraId }), 0, false);
    const r = t.run<{ entryId: string }>(
      "char.roll",
      {
        characterId: t.miraId,
        kind: "attack",
        manual: [{ diceTotal: 12 }, { diceTotal: 5 }],
        manualParts: [[part(key, 3)], []],
      },
      t.p1,
    );
    const [hit, dmg] = items(t, r.entryId);
    expect(hit?.mods?.map((m) => [m.label, m.value, m.auto])).toEqual([["Bless", 3, undefined]]);
    expect(rollRow(t, hit?.mods?.[0]?.rollId as string)?.manual).toBe(true);
    expect(dmg?.mods).toBeUndefined();
  });

  test("FR-MOD-18 char.roll: the group on the wrong roll → conflict; invalid shapes → invalid", () => {
    const t = modSetup();
    t.bless();
    const key = bonusDieKey(effectId(t, "Bless", { characterId: t.miraId }), 0, false);
    const go = (input: object) =>
      t.err(() => t.run("char.roll", { characterId: t.miraId, kind: "attack", ...input }, t.p1));
    const manual = [{ diceTotal: 12 }, { diceTotal: 5 }];
    // Bless's group sent with the damage: the to-hit misses it and the damage has a surplus.
    const swapped = go({ manual, manualParts: [[], [part(key, 3)]] });
    expect([swapped.code, swapped.message]).toEqual(["conflict", EFFECTS_CHANGED]);
    const alone = go({ manualParts: [[], []] });
    expect([alone.code, alone.issues?.[0]?.message]).toEqual(["invalid", MANUAL_PARTS_ALONE]);
    const short = go({ manual, manualParts: [[part(key, 3)]] });
    expect([short.code, short.issues?.[0]?.message]).toEqual(["invalid", MANUAL_PARTS_PER_ENTRY]);
  });

  test("FR-MOD-18 cbt.attack: per-roll lists; a damage bonus die on a crit is doubled (2d6)", () => {
    const t = modSetup();
    t.bless();
    const mark = diceEffect(
      t,
      "Mark",
      { roll: "damage", via: "weapon" },
      { characterId: t.miraId },
    );
    const blessKey = bonusDieKey(effectId(t, "Bless", { characterId: t.miraId }), 0, false);
    const r = t.run<AttackResult>(
      "cbt.attack",
      {
        attackerId: t.id("Mira"),
        manual: [{ diceTotal: 20 }, { diceTotal: 9 }],
        manualParts: [[part(blessKey, 2)], [part(`e:${mark}`, 7)]],
      },
      t.p1,
    );
    const card = t.note(r.cardId)?.payload as DamageCardPayload;
    expect(card.toHit?.mods?.map((m) => m.value)).toEqual([2]);
    expect(card.damage?.mods?.map((m) => [m.value, m.expression])).toEqual([[7, "2d6"]]);
  });
});

describe("FR-MOD-18 manualParts on single-roll intents", () => {
  test("FR-MOD-18 cbt.rollDamage: the damage part's group", () => {
    const t = modSetup();
    const mark = diceEffect(
      t,
      "Mark",
      { roll: "damage", via: "weapon" },
      { characterId: t.miraId },
    );
    const r = t.run<{ cardId: string }>(
      "cbt.rollDamage",
      {
        attackerId: t.id("Mira"),
        manual: { diceTotal: 4 },
        manualParts: [part(`e:${mark}`, 5)],
      },
      t.p1,
    );
    const card = t.note(r.cardId)?.payload as DamageCardPayload;
    expect(card.damage?.mods?.map((m) => m.value)).toEqual([5]);
    const none = t.err(() =>
      t.run(
        "cbt.rollDamage",
        { attackerId: t.id("Mira"), manual: { diceTotal: 4 }, manualParts: [] },
        t.p1,
      ),
    );
    expect([none.code, none.message]).toEqual(["conflict", EFFECTS_CHANGED]);
  });

  test("FR-MOD-18 cbt.rollAbility: Bane's group on the Goblin's save is subtracted", () => {
    const t = modSetup();
    t.apply({ targets: [{ combatantId: t.id("Goblin") }], preset: { key: "bane" } });
    const bane = effectId(t, "Bane", { combatantId: t.id("Goblin") });
    const r = t.run<{ entryId: string }>("cbt.rollAbility", {
      combatantId: t.id("Goblin"),
      kind: "save",
      ability: "dex",
      manual: { diceTotal: 11 },
      manualParts: [part(`e:${bane}`, 4)],
    });
    expect(items(t, r.entryId)[0]?.mods?.map((m) => m.value)).toEqual([-4]);
  });

  test("FR-MOD-18 cbt.rollInitiative: the initiative includes the physical group", () => {
    const t = modSetup({ round1: false });
    const alert = diceEffect(t, "Alert", { roll: "initiative" }, { characterId: t.miraId }, "1d4");
    const r = t.run<{ rollIds: string[] }>("cbt.rollInitiative", {
      combatantIds: [t.id("Mira")],
      manual: { diceTotal: 10 },
      manualParts: [part(`e:${alert}`, 3)],
    });
    expect(r.rollIds).toHaveLength(2);
    expect(rollRow(t, r.rollIds[1] as string)).toMatchObject({ manual: true, total: 3 });
  });

  test("FR-MOD-18 cbtx.rollConcentration: Bless's group counts vs the DC", () => {
    const t = modSetup();
    t.bless();
    t.hp("Mira", "damage", 1);
    const cardId = t.cards().find((c) => c.state === "pending")?.id as string;
    const bless = effectId(t, "Bless", { characterId: t.miraId });
    // CON save +4: 2 + 4 + 4 Bless = 10 ≥ DC 10.
    const r = t.run<{ entryId: string; success: boolean }>(
      "cbtx.rollConcentration",
      { notificationId: cardId, manual: { diceTotal: 2 }, manualParts: [part(`e:${bless}`, 4)] },
      t.p1,
    );
    expect(r.success).toBe(true);
    expect(items(t, r.entryId)[0]?.mods?.map((m) => [m.value, m.auto])).toEqual([[4, undefined]]);
  });

  test("FR-MOD-18 cbtx.rollDeathSave: Bless's group makes the save", () => {
    const t = modSetup();
    t.bless();
    t.hp("Thorn", "damage", 10);
    const bless = effectId(t, "Bless", { characterId: t.thornId });
    const r = t.run<{ entryId: string }>(
      "cbtx.rollDeathSave",
      {
        characterId: t.thornId,
        manual: { diceTotal: 8 },
        manualParts: [part(`e:${bless}`, 2)],
      },
      t.p2,
    );
    expect(items(t, r.entryId)[0]?.total).toBe(10);
    expect(t.character(t.thornId)).toMatchObject({ deathSuccesses: 1 });
  });

  test("FR-MOD-18 t: groups never conflict: a surplus trigger group is ignored, the roll commits", () => {
    const t = modSetup();
    t.bless();
    const bless = effectId(t, "Bless", { characterId: t.thornId });
    t.hp("Thorn", "damage", 10);
    const r = t.run<{ entryId: string }>(
      "cbtx.rollDeathSave",
      {
        characterId: t.thornId,
        manual: { diceTotal: 8 },
        manualParts: [part(`e:${bless}`, 1), part("t:no-such-trigger", 6)],
      },
      t.p2,
    );
    expect(items(t, r.entryId)[0]?.total).toBe(9);
  });
});
