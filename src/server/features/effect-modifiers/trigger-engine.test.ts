// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Rule-trigger engine (MOD §13 integration, R4): Divine Fury as data on Brakka — offered at the
// card's damage roll, settled at apply, once per turn, charges back on Undo, Next / Prev windows,
// requires with origin match, split flow mode, never failing a roll; `roll` triggers; crash.
import { describe, expect, test } from "bun:test";
import { AttackLogDmPayload, AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import type { DamageCardPayload, HpChangeRecord } from "@shared/combat-tracker/schemas";
import type {
  ManualPart,
  RollEntryDmPayload,
  RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import type { RollSubject } from "@shared/effect-modifiers/schemas";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { armCrashHook } from "../../commands/crash";
import { gameLogEntry, hpChange, notification, roll, ruleTrigger } from "../../db/schema";
import { getSheet } from "../character-sheet/sheet-rows";
import { attackCommand } from "../combat-tracker/attack";
import { applyCard } from "../combat-tracker/hp";
import { dice, type EvaluatedRoll } from "../dice-roll-log";
import type { OfferedPart } from "../dice-roll-log/roll-hooks";
import { withCardOffers } from "./offers";
import { type RtSetup, rtSetup } from "./trigger-testing";

/** A stand-in damage roll with `manualParts` (R2's tray sends them on the real intents). */
const physicalDamage = defineCommand({
  name: "test.rtPhysicalDamage",
  input: z.object({ subject: z.unknown(), manualParts: z.unknown().optional() }),
  roles: ["dm", "player"],
  execute(input, env) {
    return dice.evaluate(env, {
      expression: "1d12+4",
      mode: "normal",
      category: "damage",
      label: "Greataxe damage",
      actor: { kind: "entity", id: "x", name: "Brakka" },
      source: "cbt",
      subject: input.subject as RollSubject,
      manual: { diceTotal: 8, dice: [8] },
      ...(input.manualParts ? { manualParts: input.manualParts as ManualPart[] } : {}),
    });
  },
});

const entryOf = (t: RtSetup, rollId: string) =>
  t.s.db
    .select()
    .from(gameLogEntry)
    .all()
    .find((e) => (e.rollIds as string[]).includes(rollId));
const hpRow = (t: RtSetup, id: string) =>
  t.s.db.select().from(hpChange).where(eq(hpChange.id, id)).get() as HpChangeRecord;
const lineOf = (t: RtSetup, hpChangeId: string) => {
  const e = t.s.db
    .select()
    .from(gameLogEntry)
    .where(eq(gameLogEntry.id, hpRow(t, hpChangeId).entryId))
    .get();
  return { p: AttackLogPayload.parse(e?.payload), dm: AttackLogDmPayload.parse(e?.dmPayload) };
};
const ruleOf = (t: RtSetup, id: string) =>
  t.s.db.select().from(ruleTrigger).where(eq(ruleTrigger.id, id)).get()?.rule as TriggerRule;
const setRule = (t: RtSetup, id: string, patch: Partial<TriggerRule>) =>
  t.s.db
    .update(ruleTrigger)
    .set({ rule: { ...ruleOf(t, id), ...patch } as TriggerRule })
    .where(eq(ruleTrigger.id, id))
    .run();
const fury = (t: RtSetup, cardId: string) =>
  t.card(cardId).damage?.triggers?.find((x) => x.triggerId === t.furyId);
const assignFury = (t: RtSetup, extra: { value?: number; force?: boolean } = {}) => [
  { triggerId: t.furyId, ...extra },
];

/** Brakka's turn in round 1, raging (Rage toggled by player-1). */
function raging() {
  const t = rtSetup();
  t.nextTo("Brakka", 1);
  t.rage(true);
  return t;
}

/** Thorn's Sneak Attack from the built-in preset (MOD §8.6). */
function sneak(t: RtSetup) {
  return t.trig({
    characterId: t.thornId,
    name: "Sneak Attack",
    rule: {
      on: "hit",
      when: [
        { if: "via", via: "weapon" },
        { if: "mode", modes: ["normal", "advantage"] },
        { if: "mode", modes: ["advantage"], soft: true },
        { if: "ask", note: "finesse or ranged; or an ally within 5 ft" },
      ],
      every: "turn",
      then: { do: "damage", formula: "(ceil(level(rogue) / 2))d6", type: null },
    },
  });
}

describe("FR-MOD-37 offers at the damage roll", () => {
  test("FR-MOD-37 Brakka raging hits: Divine Fury offered (1d6+2 radiant), not in the total; roll line offered + DM name; offered use row", () => {
    const t = raging();
    const { cardId, rollIds } = t.attack("Brakka", { toHit: 15, damage: 8 });
    const p = t.card(cardId);
    // 8 + 4 + 2 (Rage) = 14; the offer is not in it.
    expect(p.damage?.total).toBe(14);
    const offer = fury(t, cardId);
    expect(offer).toMatchObject({
      label: "Divine Fury",
      expression: "1d6+2",
      type: "radiant",
    });
    expect(offer?.value).toBeGreaterThanOrEqual(3);
    expect(offer?.value).toBeLessThanOrEqual(8);
    expect(offer && "untick" in offer).toBe(false);
    expect(rollIds).toContain(offer?.rollId as string);
    const line = entryOf(t, offer?.rollId as string);
    const items = line?.payload as RollEntryPayload;
    expect(items[1]?.total).toBe(14);
    expect(items[1]?.offered).toEqual([
      expect.objectContaining({ label: "Divine Fury", value: offer?.value, type: "radiant" }),
    ]);
    expect(items[1]?.offered?.[0]?.dice).toHaveLength(1);
    expect((line?.dmPayload as RollEntryDmPayload | undefined)?.items[1]?.offered).toEqual([
      { triggerId: t.furyId, label: "Divine Fury" },
    ]);
    expect(t.uses().map((u) => [u.state, u.cardId, u.window, u.part])).toEqual([
      ["offered", cardId, `t:1:${t.id("Brakka")}`, 0],
    ]);
  });

  test("FR-MOD-36 requires-effect off: no Rage → no offer; Rage ended between roll and apply → the part still applies", () => {
    const t = rtSetup();
    t.nextTo("Brakka", 1);
    expect(t.offers(t.attack("Brakka").cardId)).toEqual([]);
    t.rage(true);
    const { cardId } = t.attack("Brakka");
    t.rage(false);
    const { hpChangeIds } = t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t) }]);
    expect(hpRow(t, hpChangeIds[0] as string).triggerParts).toEqual([
      {
        triggerId: t.furyId,
        name: "Divine Fury",
        value: fury(t, cardId)?.value as number,
        multiplier: "normal",
        type: "radiant",
        forced: false,
      },
    ]);
  });

  test("FR-MOD-36 origin match (R5): DM applies built-in rage → offered; a trigger requiring `rage` fires on her toggled preset", () => {
    const t = rtSetup();
    t.nextTo("Brakka", 1);
    t.apply({ targets: [{ characterId: t.brakkaId }], preset: { key: "rage" } });
    expect(t.offers(t.attack("Brakka").cardId)).toEqual([t.furyId]);
    const u = rtSetup();
    u.nextTo("Brakka", 1);
    setRule(u, u.furyId, { requires: { preset: "rage" } });
    u.rage(true);
    expect(u.offers(u.attack("Brakka").cardId)).toEqual([u.furyId]);
  });

  test("FR-MOD-37 ownTurn: Brakka's attack on the Wolf's turn → no Divine Fury; Thorn's Sneak Attack yes, with its own window", () => {
    const t = rtSetup();
    t.rage(true);
    const sa = sneak(t);
    expect(t.turnName()).toBe("Wolf");
    expect(t.offers(t.attack("Brakka").cardId)).toEqual([]);
    const opp = t.attack("Thorn", { damage: 3 }).cardId;
    expect(t.offers(opp)).toEqual([sa]);
    t.applyTo(opp, [{ name: "Goblin", triggers: [{ triggerId: sa }] }]);
    t.nextTo("Thorn", 1);
    expect(t.offers(t.attack("Thorn", { damage: 3 }).cardId)).toEqual([sa]);
    expect(t.usesOf(sa).map((u) => u.window)).toEqual([
      `t:1:${t.id("Wolf")}`,
      `t:1:${t.id("Thorn")}`,
    ]);
  });

  test("FR-MOD-37 crit doubles the d6 (2d6+2); a crit-filtered trigger's dice don't double (§8.4)", () => {
    const t = raging();
    const brutal = t.trig({
      characterId: t.brakkaId,
      name: "Brutal",
      rule: {
        on: "hit",
        when: [{ if: "crit" }],
        every: "each",
        then: { do: "damage", formula: "1d12", type: null },
      },
    });
    const normal = t.attack("Brakka", { toHit: 15 }).cardId;
    expect(t.offers(normal)).toEqual([t.furyId]);
    const crit = t.attack("Brakka", { toHit: 20, damage: 16 }).cardId;
    const parts = t.card(crit).damage?.triggers ?? [];
    expect(parts.map((x) => [x.triggerId, x.expression])).toEqual([
      [t.furyId, "2d6+2"],
      [brutal, "1d12"],
    ]);
  });

  test("FR-MOD-37 split flow mode (R4): to-hit with advantage → Damage → Sneak Attack offered ticked; damage-only card → normal → offered, untick; disadvantage → none", () => {
    const t = rtSetup();
    const sa = sneak(t);
    t.nextTo("Thorn", 1);
    const toHit = t.attack("Thorn", { rolls: "toHit", mode: "advantage" }).cardId;
    expect(t.card(toHit).damage).toBeNull();
    const done = t.rollDamage("Thorn", 3);
    expect(done.cardId).toBe(toHit);
    const ticked = t.card(toHit).damage?.triggers?.[0];
    expect(ticked).toMatchObject({
      triggerId: sa,
      expression: "1d6",
      ask: "finesse or ranged; or an ally within 5 ft",
    });
    expect(ticked?.untick).toBeUndefined();
    // The damage `roll` entry carries the same offered part (R1).
    const items = entryOf(t, ticked?.rollId as string)?.payload as RollEntryPayload;
    expect(items[0]?.offered?.[0]).toMatchObject({ value: ticked?.value, label: "Sneak Attack" });
    const only = t.rollDamage("Thorn", 3);
    expect(only.attached).toBe(false);
    expect(t.card(only.cardId).damage?.triggers?.[0]).toMatchObject({
      triggerId: sa,
      untick: true,
    });
    const dis = t.attack("Thorn", { mode: "disadvantage", damage: 3 }).cardId;
    expect(t.offers(dis)).toEqual([]);
  });

  test("FR-MOD-37 settle facts: a targetMarked trigger's offer carries the campaign mark and `hurt` (target-side filters never gate the roll)", () => {
    const t = rtSetup();
    const mark = t.put(t.from("bless", { name: "Favored Foe" }));
    const ff = t.trig({
      characterId: t.thornId,
      name: "Favored Foe",
      rule: {
        on: "hit",
        when: [{ if: "targetMarked", preset: mark }, { if: "targetHurt" }],
        every: "turn",
        then: { do: "damage", formula: "1d4", type: null },
      },
    });
    t.nextTo("Thorn", 1);
    expect(t.card(t.attack("Thorn", { damage: 3 }).cardId).damage?.triggers?.[0]).toMatchObject({
      triggerId: ff,
      marked: mark,
      hurt: true,
    });
  });
});

describe("FR-MOD-37 card mode (R4)", () => {
  test("FR-MOD-37 the card stores the to-hit's final mode (its roll row's), which `cbt.rollDamage` passes to mode filters", () => {
    const t = rtSetup();
    const sa = sneak(t);
    t.nextTo("Thorn", 1);
    const { cardId } = t.attack("Thorn", { rolls: "toHit", mode: "advantage" });
    const p = t.card(cardId);
    const row = t.s.db
      .select()
      .from(roll)
      .where(eq(roll.id, p.toHit?.rollId as string))
      .get();
    expect([p.mode, row?.mode]).toEqual(["advantage", "advantage"]);
    t.rollDamage("Thorn", 3);
    expect(t.card(cardId).damage?.triggers?.[0]).toMatchObject({ triggerId: sa });
    expect(t.card(cardId).damage?.triggers?.[0]?.untick).toBeUndefined();
  });
});

describe("FR-MOD-37 tier 2 (after R1)", () => {
  test("FR-MOD-37 Reckless (modes() pre-roll): a normal request rolls adv; the card stores advantage; Sneak Attack offered ticked", () => {
    const t = rtSetup();
    const sa = sneak(t);
    t.nextTo("Thorn", 1);
    t.apply({ targets: [{ characterId: t.thornId }], preset: { key: "reckless" } });
    const { cardId } = t.s.commands.run(
      attackCommand.name,
      { attackerId: t.id("Thorn"), rolls: "toHit" },
      { actor: t.p2 },
    ) as { cardId: string };
    expect(t.card(cardId).mode).toBe("advantage");
    t.rollDamage("Thorn", 3, t.p2);
    const part = t.card(cardId).damage?.triggers?.[0];
    expect(part).toMatchObject({ triggerId: sa });
    expect(part?.untick).toBeUndefined();
  });

  test("FR-MOD-43 a `roll` trigger's mode: its hint comes before the d20 (two d20s), named; a `turn` one spends its charge", () => {
    const t = rtSetup();
    t.nextTo("Brakka", 1);
    const id = t.trig({
      characterId: t.brakkaId,
      name: "Feral Instinct",
      rule: {
        on: "roll",
        when: [{ if: "roll", on: { roll: "attack", via: "weapon" } }],
        every: "turn",
        then: { do: "mode", mode: "advantage" },
      },
    });
    const atk = () =>
      t.roll(
        { creature: { characterId: t.brakkaId }, roll: "attack", via: "weapon" },
        { actorName: "Brakka" },
      ).roll;
    const first = atk();
    expect([first.mode, first.dice.length]).toEqual(["advantage", 2]);
    expect(first.mods?.modes.map((m) => [m.triggerId, m.label])).toEqual([[id, "Feral Instinct"]]);
    expect(t.usesOf(id).map((u) => u.state)).toEqual(["used"]);
    expect(atk().mode).toBe("normal");
  });

  test("FR-MOD-18 offered dice from a physical `t:` group (not auto); a surplus or bad group never conflicts", () => {
    const t = raging();
    const roll = (manualParts?: unknown) =>
      t.s.commands.run(
        physicalDamage.name,
        {
          subject: {
            creature: { characterId: t.brakkaId },
            roll: "damage",
            via: "weapon",
            card: true,
          },
          manualParts,
        },
        { actor: t.p1 },
      ) as EvaluatedRoll;
    t.s.commands.register(physicalDamage);
    const r = roll([{ key: `t:${t.furyId}`, entry: { diceTotal: 4, dice: [4] } }]);
    expect(r.mods?.offered?.[0]).toMatchObject({ value: 6, expression: "1d6+2", dice: [4] });
    expect(r.mods?.offered?.[0]?.auto).toBeUndefined();
    const bad = roll([{ key: `t:${t.furyId}`, entry: { diceTotal: 9, dice: [9] } }]);
    expect(bad.mods?.offered?.[0]?.auto).toBe(true);
    const none = roll();
    expect(none.mods?.offered?.[0]?.auto).toBe(true);
  });
});

describe("FR-MOD-34 / -37 never fails the roll", () => {
  test("FR-MOD-34 a trigger over 25 dice at fire time (level raised in the DB) → skipped with a DM note, the roll commits", () => {
    const t = raging();
    setRule(t, t.furyId, {
      then: { do: "damage", formula: "(level * 4)d6 + (level * 2)d8", type: "radiant" },
    });
    const { cardId, rollIds } = t.attack("Brakka");
    expect(t.offers(cardId)).toEqual([]);
    const line = entryOf(t, rollIds[0] as string);
    expect((line?.dmPayload as RollEntryDmPayload | undefined)?.notes).toEqual([
      "Divine Fury skipped: Too many dice: 30 > 25",
    ]);
    expect(JSON.stringify(line?.payload)).not.toContain("skipped");
    expect(t.uses()).toEqual([]);
  });

  test("FR-MOD-37 > 4 offers → the rest skipped with a note; a card past 4 KB drops the last offers (rows gone) with the DM note (R10)", () => {
    const t = raging();
    for (let i = 0; i < 4; i++) {
      t.trig({
        characterId: t.brakkaId,
        name: `Extra ${i}`,
        rule: {
          on: "hit",
          when: [],
          every: "each",
          then: { do: "damage", formula: "1d4", type: null },
        },
      });
    }
    const { cardId, rollIds } = t.attack("Brakka");
    expect(t.offers(cardId)).toHaveLength(4);
    expect(
      (entryOf(t, rollIds[0] as string)?.dmPayload as RollEntryDmPayload | undefined)?.notes,
    ).toEqual(["+ 1 trigger skipped"]);
    // The card cap: a payload padded to the edge loses offers from the last.
    const offered: OfferedPart[] = [0, 1, 2, 3].map((i) => ({
      triggerId: `t${i}`,
      label: "x".repeat(40),
      public: true,
      value: 3,
      expression: "1d6",
      rollId: `missing-roll-${i}`,
      type: null,
      ask: "y".repeat(60),
    }));
    const damage = {
      mods: { parts: [], modTotal: 0, modes: [], offered },
    } as unknown as EvaluatedRoll;
    const base = t.card(cardId);
    const payload: DamageCardPayload = {
      ...base,
      attackName: "z".repeat(3300),
      damage: { ...(base.damage as NonNullable<DamageCardPayload["damage"]>), triggers: undefined },
    };
    const fitted = t.s.db.transaction((tx) => withCardOffers({ tx }, payload, damage));
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(4096);
    const kept = fitted.damage?.triggers?.length ?? 0;
    expect(kept).toBeLessThan(4);
    expect(damage.mods?.offered).toHaveLength(kept);
    expect(damage.mods?.notes).toEqual([
      `+ ${4 - kept} trigger${4 - kept === 1 ? "" : "s"} skipped`,
    ]);
  });
});

describe("FR-MOD-38 settled at apply", () => {
  test("FR-MOD-38 raw = weapon + parts with multipliers (Half row, radiant part Normal); hp_change triggerParts; line parts; DM line names it", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka", { damage: 8 }); // 14 slashing
    const part = fury(t, cardId);
    const v = part?.value as number;
    const before = t.byName(t.enc.id).Goblin?.hpCurrent as number;
    const { hpChangeIds } = t.applyTo(cardId, [
      {
        name: "Goblin",
        multiplier: "half",
        triggers: [{ triggerId: t.furyId, multiplier: "normal" }],
      },
    ]);
    const r = hpRow(t, hpChangeIds[0] as string);
    expect(r.raw).toBe(7 + v);
    expect(r.hpBefore).toBe(before);
    expect(r.triggerParts).toEqual([
      {
        triggerId: t.furyId,
        name: "Divine Fury",
        value: v,
        multiplier: "normal",
        type: "radiant",
        forced: false,
      },
    ]);
    const line = lineOf(t, r.id);
    expect(line.p.parts).toEqual([{ label: "Divine Fury", value: v, type: "radiant" }]);
    expect(line.dm.parts).toEqual([{ triggerId: t.furyId, label: "Divine Fury", rolled: v }]);
    const [use] = t.usesOf(t.furyId);
    expect(use).toMatchObject({
      state: "used",
      targetId: t.id("Goblin"),
      hpChangeId: r.id,
      value: v,
      multiplier: "normal",
      forced: false,
    });
  });

  test("FR-MOD-40 value edit: the DM's value lands (DM line keeps the rolled one); unassigned offers stay offered", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka", { damage: 8 });
    const rolled = fury(t, cardId)?.value as number;
    const { hpChangeIds } = t.applyTo(cardId, [
      { name: "Goblin", triggers: assignFury(t, { value: 9 }) },
    ]);
    const line = lineOf(t, hpChangeIds[0] as string);
    expect(line.p.parts?.[0]?.value).toBe(9);
    expect(line.dm.parts?.[0]?.rolled).toBe(rolled);
    expect(hpRow(t, hpChangeIds[0] as string).raw).toBe(14 + 9);
  });

  test("FR-MOD-38 unassigned offers stay offered (no charge spent); the card resolves", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka");
    t.applyTo(cardId, [{ name: "Goblin 2" }]);
    expect(t.note(cardId)?.state).toBe("resolved");
    expect(t.usesOf(t.furyId).map((u) => u.state)).toEqual(["offered"]);
    expect(t.offers(t.attack("Brakka").cardId)).toEqual([t.furyId]);
  });

  test("FR-MOD-38 invalid assignment: a Miss row or a trigger not on the card → invalid; nothing written", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka");
    expect(
      t.err(() => t.applyTo(cardId, [{ name: "Goblin", hit: false, triggers: assignFury(t) }]))
        .code,
    ).toBe("invalid");
    expect(
      t.err(() => t.applyTo(cardId, [{ name: "Goblin", triggers: [{ triggerId: "nope" }] }])).code,
    ).toBe("invalid");
    expect(t.usesOf(t.furyId).map((u) => u.state)).toEqual(["offered"]);
    expect(t.note(cardId)?.state).toBe("pending");
  });

  test('FR-MOD-47 a non-public trigger\'s part has no label in the line ("(DM)"); the value is public', () => {
    const t = raging();
    t.s.db.update(ruleTrigger).set({ public: false }).where(eq(ruleTrigger.id, t.furyId)).run();
    const { cardId } = t.attack("Brakka");
    const { hpChangeIds } = t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t) }]);
    const line = lineOf(t, hpChangeIds[0] as string);
    expect(line.p.parts?.[0]).toMatchObject({ label: null, type: "radiant" });
    expect(line.dm.parts?.[0]?.label).toBe("Divine Fury");
    const items = entryOf(t, fury(t, cardId)?.rollId as string)?.payload as RollEntryPayload;
    expect(items[1]?.offered?.[0]?.label).toBeNull();
  });
});

describe("FR-MOD-42 once per turn", () => {
  test("FR-MOD-42 once per turn: offer → apply → used; a second card the same turn has no offer", () => {
    const t = raging();
    const first = t.attack("Brakka").cardId;
    t.applyTo(first, [{ name: "Goblin", triggers: assignFury(t) }]);
    expect(t.offers(t.attack("Brakka").cardId)).toEqual([]);
  });

  test("FR-MOD-42 two cards rolled before either apply: second apply → conflict; force → forced, no second spend", () => {
    const t = raging();
    const a = t.attack("Brakka").cardId;
    const b = t.attack("Brakka").cardId;
    expect(t.offers(b)).toEqual([t.furyId]);
    t.applyTo(a, [{ name: "Goblin", triggers: assignFury(t) }]);
    const e = t.err(() => t.applyTo(b, [{ name: "Goblin 2", triggers: assignFury(t) }]));
    expect([e.code, e.message]).toEqual(["conflict", "Divine Fury was already used this turn"]);
    expect(t.note(b)?.state).toBe("pending");
    const { hpChangeIds } = t.applyTo(b, [
      { name: "Goblin 2", triggers: assignFury(t, { force: true }) },
    ]);
    expect(hpRow(t, hpChangeIds[0] as string).triggerParts[0]?.forced).toBe(true);
    expect(lineOf(t, hpChangeIds[0] as string).dm.parts?.[0]?.forced).toBe(true);
    expect(t.usesOf(t.furyId).map((u) => [u.state, u.forced])).toEqual([
      ["used", false],
      ["used", true],
    ]);
  });

  test("FR-MOD-41 undo restores the charge: apply → undo → card reopened with the part, charge free; re-apply to Goblin 2 lands it", () => {
    const t = raging();
    const { cardId } = t.attack("Brakka");
    const part = fury(t, cardId);
    const goblin = t.byName(t.enc.id).Goblin?.hpCurrent;
    t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t) }]);
    t.undo();
    expect(t.byName(t.enc.id).Goblin?.hpCurrent).toBe(goblin);
    expect(t.note(cardId)?.state).toBe("pending");
    expect(fury(t, cardId)).toEqual(part);
    expect(t.usesOf(t.furyId)).toEqual([
      expect.objectContaining({ state: "offered", targetId: null, hpChangeId: null, value: null }),
    ]);
    const { hpChangeIds } = t.applyTo(cardId, [{ name: "Goblin 2", triggers: assignFury(t) }]);
    expect(t.usesOf(t.furyId)[0]).toMatchObject({
      state: "used",
      targetId: t.id("Goblin 2"),
      hpChangeId: hpChangeIds[0],
    });
  });

  test("FR-MOD-41 feature frequency: apply spends a Rage use; no use left → conflict; undo refunds", () => {
    const t = raging();
    setRule(t, t.furyId, { every: { feature: t.rageRowId } });
    const used = () =>
      getSheet(t.s.db as never, t.brakkaId)?.features.find((f) => f.id === t.rageRowId)?.used;
    const { cardId } = t.attack("Brakka");
    t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t) }]);
    expect(used()).toBe(1);
    const applied = t.events.findLast((e) => e.event.type === "AttackApplied");
    expect(applied?.event.changes.some((c) => c.type === "creature-sheet")).toBe(true);
    t.undo();
    expect(used()).toBe(0);
    t.run("char.useResource", {
      characterId: t.brakkaId,
      resource: { feature: t.rageRowId },
      delta: 3,
    });
    const e = t.err(() => t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t) }]));
    expect([e.code, e.message]).toEqual(["conflict", "Divine Fury: no Rage uses left"]);
    t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t, { force: true }) }]);
    expect(used()).toBe(3);
    t.undo();
    expect(used()).toBe(3);
  });

  test("FR-MOD-42 turn-start reset: Next to Brakka's next turn → offered again", () => {
    const t = raging();
    t.applyTo(t.attack("Brakka").cardId, [{ name: "Goblin", triggers: assignFury(t) }]);
    // Next to Brakka's turn in round 2 (a downed goblin is skipped).
    t.nextTo("Brakka", 2);
    expect(t.offers(t.attack("Brakka").cardId)).toEqual([t.furyId]);
  });

  test("FR-MOD-42 Prev: used in Brakka's turn → Next → Prev → no offer; a mistaken Next + Prev before attacking → offer", () => {
    const t = raging();
    t.applyTo(t.attack("Brakka").cardId, [{ name: "Goblin", triggers: assignFury(t) }]);
    t.step("next");
    t.step("prev");
    expect(t.offers(t.attack("Brakka").cardId)).toEqual([]);
    const u = raging();
    u.step("next");
    u.step("prev");
    expect(u.offers(u.attack("Brakka").cardId)).toEqual([u.furyId]);
  });
});

describe("FR-MOD-43 roll triggers", () => {
  const part = (every: TriggerRule["every"], names?: string[]): TriggerRule => ({
    on: "roll",
    when: [
      { if: "roll", on: { roll: "damage", via: "weapon" } },
      ...(names ? [{ if: "row" as const, names }] : []),
    ],
    every,
    then: { do: "part", formula: "1d4 + 1" },
  });
  const dmg = (t: RtSetup, row: string) =>
    t.roll(
      { creature: { characterId: t.brakkaId }, roll: "damage", via: "weapon", row },
      { expression: "1d12+4", actorName: "Brakka" },
    ).roll;

  test("FR-MOD-43 out of combat: `each` adds its part (row filter: Greataxe only); `turn` adds nothing", () => {
    const t = rtSetup({ inCombat: false });
    const each = t.trig({
      characterId: t.brakkaId,
      name: "Savage",
      rule: part("each", ["Greataxe"]),
    });
    const greataxe = dmg(t, "Greataxe");
    expect(greataxe.mods?.parts.map((p) => [p.triggerId, p.label, p.expression])).toEqual([
      [each, "Savage", "1d4+1"],
    ]);
    expect(dmg(t, "Handaxe").mods?.parts).toEqual([]);
    t.s.db
      .update(ruleTrigger)
      .set({ rule: part("turn") })
      .where(eq(ruleTrigger.id, each))
      .run();
    expect(dmg(t, "Greataxe").mods?.parts).toEqual([]);
    expect(t.uses()).toEqual([]);
  });

  test("FR-MOD-43 in combat: a `turn` part lands once per turn (used at once); a formula error → note, roll commits", () => {
    const t = rtSetup();
    t.nextTo("Brakka", 1);
    const id = t.trig({ characterId: t.brakkaId, name: "Savage", rule: part("turn") });
    expect(dmg(t, "Greataxe").mods?.parts.map((p) => p.triggerId)).toEqual([id]);
    expect(t.usesOf(id).map((u) => [u.state, u.window])).toEqual([
      ["used", `t:1:${t.id("Brakka")}`],
    ]);
    expect(dmg(t, "Greataxe").mods?.parts).toEqual([]);
    t.step("next");
    setRule(t, id, {
      every: "each",
      then: { do: "part", formula: "(level * 4)d6 + (level * 2)d8" },
    });
    const r = dmg(t, "Greataxe");
    expect(r.mods?.parts).toEqual([]);
    expect(r.mods?.notes).toEqual(["Savage skipped: Too many dice: 30 > 25"]);
  });

  test("FR-MOD-43 sheet damage roll out of combat: an `each` trigger part via char.roll", () => {
    const t = rtSetup({ inCombat: false });
    t.trig({ characterId: t.brakkaId, name: "Savage", rule: part("each") });
    const r = t.run<{ entryId: string }>(
      "char.roll",
      { characterId: t.brakkaId, kind: "damage" },
      t.p1,
    );
    const e = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, r.entryId)).get();
    expect((e?.payload as RollEntryPayload | undefined)?.[0]?.mods?.map((m) => m.label)).toEqual([
      "Savage",
    ]);
  });

  test("FR-MOD-13 char.roll passes subject.row: a `row` Greataxe trigger adds to the sheet's Greataxe damage, a Handaxe one doesn't", () => {
    const t = rtSetup({ inCombat: false });
    t.trig({ characterId: t.brakkaId, name: "Savage", rule: part("each", ["greataxe"]) });
    t.trig({ characterId: t.brakkaId, name: "Thrown", rule: part("each", ["Handaxe"]) });
    const labels = (kind: "damage" | "attack") => {
      const r = t.run<{ entryId: string }>("char.roll", { characterId: t.brakkaId, kind }, t.p1);
      const e = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, r.entryId)).get();
      return (e?.payload as RollEntryPayload).map((i) => i.mods?.map((m) => m.label) ?? []);
    };
    expect(labels("damage")).toEqual([["Savage"]]);
    // Attack + damage: the to-hit has no damage part; the damage row matches by name.
    expect(labels("attack")).toEqual([[], ["Savage"]]);
  });
});

describe("FR-MOD-51 crash safety", () => {
  test("FR-MOD-51 hard kill: cbt.attack after-commit → card + offer + use row; cbt.applyCard before-commit → nothing; after-commit → HP + used", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = raging();
    let cardId = "";
    try {
      armCrashHook({ point: "after-commit", target: attackCommand.name }, kill);
      expect(() => t.attack("Brakka")).toThrow(Killed);
    } finally {
      armCrashHook(null);
    }
    const card = t.s.db
      .select()
      .from(notification)
      .all()
      .find((n) => n.kind === "damage-card");
    cardId = card?.id as string;
    expect(t.offers(cardId)).toEqual([t.furyId]);
    expect(t.usesOf(t.furyId).map((u) => u.state)).toEqual(["offered"]);
    const rolls = t.s.db.select().from(roll).all().length;
    const hp = t.byName(t.enc.id).Goblin?.hpCurrent;
    try {
      armCrashHook({ point: "before-commit", target: applyCard.name }, kill);
      expect(() => t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t) }])).toThrow();
      expect(t.byName(t.enc.id).Goblin?.hpCurrent).toBe(hp);
      expect(t.usesOf(t.furyId).map((u) => u.state)).toEqual(["offered"]);
      expect(t.s.db.select().from(hpChange).all()).toEqual([]);
      armCrashHook({ point: "after-commit", target: applyCard.name }, kill);
      expect(() => t.applyTo(cardId, [{ name: "Goblin", triggers: assignFury(t) }])).toThrow(
        Killed,
      );
    } finally {
      armCrashHook(null);
    }
    expect(t.usesOf(t.furyId).map((u) => u.state)).toEqual(["used"]);
    expect(t.byName(t.enc.id).Goblin?.hpCurrent).toBeLessThan(hp as number);
    expect(t.s.db.select().from(roll).all().length).toBe(rolls);
  });
});
