// Sprint 4 S4-1b (FR-CBT-81–84, FR-MOD-58; MOD §13.1): Brakka's Flame Tongue greatsword +1
// (`2d6+4` slashing, bonus 1, extra `2d6` fire) in combat: the card's parts, per-part multipliers
// at apply (Goblin under Fire Ward), the crit doubling every part, the outcome line and the
// hp_change row; Rage +2 and Divine Fury from `rtSetup` (MOD's test support).
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import type { AttackLogDmPayload, AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import type {
  AttackResult,
  HpChangesResult,
  RollDamageResult,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { ManualEntry } from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { combatant, entity, gameLogEntry, hpChange, roll } from "../../db/schema";
import type { Actor } from "../../events/types";
import { rtSetup } from "../effect-modifiers/trigger-testing";
import { attackCommand } from "./attack";
import { rollDamageCommand } from "./damage";
import { applyCard, undoCommand } from "./hp";

function flameTongue(o: { rage?: boolean; ward?: boolean } = {}) {
  const t = rtSetup();
  const attackId = t.run<{ rowId: string }>(CHARX_INTENTS.putRow, {
    creatureId: t.brakkaId,
    list: "attacks",
    row: {
      name: "Flame Tongue greatsword",
      toHit: 7,
      damage: "2d6+4",
      damageType: "slashing",
      bonus: 1,
      extraDamage: [{ damage: "2d6", type: "fire" }],
    },
  }).rowId;
  if (o.ward !== false) {
    const presetId = t.put({
      characterId: null,
      name: "Fire Ward",
      modifiers: [{ kind: "defense", types: ["fire"], level: "resistance" }],
      durationRounds: null,
      concentration: false,
      note: "",
    });
    t.apply({ targets: [{ combatantId: t.id("Goblin") }], preset: { presetId } });
  }
  t.nextTo("Brakka", 1);
  if (o.rage !== false) t.rage(true);
  const attack = (
    manual: ManualEntry[] | undefined,
    manualExtra?: ManualEntry[],
    extra: Record<string, unknown> = {},
    actor: Actor = t.p1,
  ) =>
    t.seeded<AttackResult>(
      attackCommand.name,
      {
        attackerId: t.id("Brakka"),
        attackId,
        ...(manual ? { manual } : {}),
        ...(manualExtra ? { manualExtra } : {}),
        ...extra,
      },
      actor,
    );
  /** Step 3: d20 14; slashing 3, 5; fire 2, 6. */
  const step3 = () =>
    attack([{ diceTotal: 14 }, { diceTotal: 8, dice: [3, 5] }], [{ diceTotal: 8, dice: [2, 6] }]);
  const apply = (cardId: string, targets: unknown[], more: Record<string, unknown> = {}) => {
    const p = t.card(cardId);
    return t.run<HpChangesResult>(applyCard.name, {
      cardId,
      ...(p.toHit ? { toHitTotal: p.toHit.total } : {}),
      damageTotal: p.damage?.total ?? 0,
      targets,
      ...more,
    });
  };
  const row = (id: string) => t.s.db.select().from(hpChange).where(eq(hpChange.id, id)).get();
  const entryOf = (hpChangeId: string) =>
    t.s.db
      .select()
      .from(gameLogEntry)
      .where(eq(gameLogEntry.id, row(hpChangeId)?.entryId as string))
      .get();
  const lines = (hpChangeId: string) => {
    const e = entryOf(hpChangeId);
    if (!e) throw new Error("no line");
    const of = (dm: boolean) =>
      lineText(
        formatEntry({
          kind: e.kind,
          actorName: e.actorName,
          payload: e.payload,
          dmPayload: dm ? e.dmPayload : null,
        }).segments,
      );
    return { dm: of(true), players: of(false) };
  };
  const fury = (cardId: string) =>
    t.card(cardId).damage?.triggers?.find((x) => x.triggerId === t.furyId);
  return { ...t, attackId, attack, step3, apply, row, entryOf, lines, fury };
}

describe("FR-CBT-81 card parts", () => {
  test("FR-CBT-81 cbt.attack card damage.extra [fire], text '22 to hit, 15 slashing + 8 fire', base total = dice + 1 + Rage 2", () => {
    const t = flameTongue();
    const { cardId, rollIds } = t.step3();
    const p = t.card(cardId);
    expect(p.toHit?.total).toBe(22);
    expect(p.damage?.total).toBe(15);
    expect(p.damage?.constant).toBe(5);
    expect(p.damage?.extra).toEqual([
      {
        type: "fire",
        rollId: expect.any(String),
        dice: [
          [2, true],
          [6, true],
        ],
        constant: 0,
        total: 8,
        manual: true,
      },
    ]);
    const v = t.fury(cardId)?.value as number;
    expect(t.note(cardId)?.text).toBe(
      `Brakka: 22 to hit, 15 slashing + 8 fire (+ ${v} radiant Divine Fury on a hit)`,
    );
    // The extra part is its own roll row of the entry (FR-DICE-26), no effect mods on it.
    const extraId = p.damage?.extra?.[0]?.rollId as string;
    expect(rollIds).toContain(extraId);
    const r = t.s.db.select().from(roll).where(eq(roll.id, extraId)).get();
    expect(r).toMatchObject({
      expression: "2d6",
      total: 8,
      label: "Flame Tongue greatsword damage (fire)",
    });
    const line = t.s.db
      .select()
      .from(gameLogEntry)
      .all()
      .find((e) => (e.rollIds as string[]).includes(extraId));
    expect(((line?.payload ?? []) as { rollId: string }[]).map((x) => x.rollId)).toContain(extraId);
  });

  test("FR-CBT-81 cbt.rollDamage completes a to-hit-only card with its parts; a damage-only card has them from the start", () => {
    const t = flameTongue({ rage: false });
    const { cardId } = t.attack([{ diceTotal: 14 }], undefined, { rolls: "toHit" });
    expect(t.note(cardId)?.text).toBe("Brakka: 22 to hit (Flame Tongue greatsword)");
    const r = t.seeded<RollDamageResult>(
      rollDamageCommand.name,
      {
        attackerId: t.id("Brakka"),
        attackId: t.attackId,
        manual: { diceTotal: 8 },
        manualExtra: [{ diceTotal: 9 }],
      },
      t.p1,
    );
    expect(r).toMatchObject({ cardId, attached: true });
    expect(t.note(cardId)?.text).toBe("Brakka: 22 to hit, 13 slashing + 9 fire");
    expect(r.rollIds).toContain(t.card(cardId).damage?.extra?.[0]?.rollId as string);
    const only = t.seeded<RollDamageResult>(
      rollDamageCommand.name,
      { attackerId: t.id("Brakka"), attackId: t.attackId },
      t.p1,
    );
    expect(only.attached).toBe(false);
    const p = t.card(only.cardId);
    expect(p.damage?.extra).toHaveLength(1);
    expect(t.note(only.cardId)?.text).toBe(
      `Brakka: ${p.damage?.total} slashing + ${p.damage?.extra?.[0]?.total} fire (Flame Tongue greatsword)`,
    );
  });

  test("FR-CBT-81 physical entries: one per extra part, else invalid; nothing written", () => {
    const t = flameTongue();
    const before = t.s.db.select().from(roll).all().length;
    expect(() => t.attack([{ diceTotal: 14 }, { diceTotal: 8 }])).toThrow(
      "Enter 1 physical damage part",
    );
    expect(() =>
      t.attack([{ diceTotal: 14 }, { diceTotal: 8 }], [{ diceTotal: 8 }, { diceTotal: 8 }]),
    ).toThrow("Enter 1 physical damage part");
    expect(() => t.attack(undefined, [{ diceTotal: 8 }])).toThrow();
    expect(t.s.db.select().from(roll).all().length).toBe(before);
  });
});

describe("FR-CBT-81 monster rows", () => {
  test("FR-CBT-81 a monster attack row with an extra part rolls the same way from the DM's Attack; its roll line stays DM-only", () => {
    const t = flameTongue({ rage: false, ward: false });
    const goblin = t.s.db
      .select()
      .from(combatant)
      .where(eq(combatant.id, t.id("Goblin")))
      .get();
    const def = t.s.db
      .select()
      .from(entity)
      .where(eq(entity.id, goblin?.entityId as string))
      .get();
    const stats = def?.statBlock as { attacks: Record<string, unknown>[] };
    t.s.db
      .update(entity)
      .set({
        statBlock: {
          ...stats,
          attacks: [
            { ...stats.attacks[0], bonus: 2, extraDamage: [{ damage: "1d4", type: "poison" }] },
          ],
        },
      })
      .where(eq(entity.id, def?.id as string))
      .run();
    const { cardId, rollIds } = t.seeded<AttackResult>(attackCommand.name, {
      attackerId: t.id("Goblin"),
    });
    const p = t.card(cardId);
    expect(p.damage?.extra?.map((x) => x.type)).toEqual(["poison"]);
    const line = t.s.db
      .select()
      .from(gameLogEntry)
      .all()
      .find((e) => (e.rollIds as string[]).includes(rollIds.at(-1) as string));
    expect(line?.public).toBe(false);
    expect(t.note(cardId)?.text).toContain(` + ${p.damage?.extra?.[0]?.total} poison`);
  });
});

describe("FR-CBT-82 two damage types applied per part with resistance", () => {
  test("FR-CBT-82 Goblin (Fire Ward) Hit: slashing Normal 15, fire Half 8 → 4, + Divine Fury Normal → raw 19 + fury; hp_change damageParts", () => {
    const t = flameTongue();
    const { cardId } = t.step3();
    const v = t.fury(cardId)?.value as number;
    const { hpChangeIds } = t.apply(cardId, [
      {
        targetId: t.id("Goblin"),
        hit: true,
        multiplier: "normal",
        extraMultipliers: ["half"],
        triggers: [{ triggerId: t.furyId }],
      },
    ]);
    const r = t.row(hpChangeIds[0] as string);
    expect(r?.raw).toBe(15 + 4 + v);
    expect(r?.damageTotal).toBe(15);
    expect(r?.damageParts).toEqual([
      { type: "fire", rolled: 8, total: 8, multiplier: "half", raw: 4 },
    ]);
    // FR-MOD-58: MOD's target-facts line names the per-part preset for the DM.
    const dm = t.entryOf(hpChangeIds[0] as string)?.dmPayload as AttackLogDmPayload;
    expect(dm.extraDefense).toEqual([{ type: "fire", level: "resistance", label: "Fire Ward" }]);
    // Resolution `applied` = the sum.
    const res = t.note(cardId)?.resolution as { targets: { applied: number }[] };
    expect(res.targets[0]?.applied).toBeGreaterThan(0);
  });

  test("FR-CBT-82 the multiplier comes from the input, not recomputed; absent = the row's; DM values per part", () => {
    const t = flameTongue({ rage: false });
    const { cardId } = t.step3();
    // Goblin has Fire Ward but the DM sends no part multiplier: the row's (double) applies.
    const { hpChangeIds } = t.apply(
      cardId,
      [
        { targetId: t.id("Goblin"), hit: true, multiplier: "double" },
        { targetId: t.id("Goblin 2"), hit: true, multiplier: "normal", extraMultipliers: ["none"] },
        { targetId: t.id("Wolf"), hit: false, multiplier: "normal" },
      ],
      { extraTotals: [10] },
    );
    const [g, g2, w] = hpChangeIds.map((id) => t.row(id));
    expect(g?.raw).toBe(13 * 2 + 10 * 2);
    expect(g?.damageParts?.[0]).toEqual({
      type: "fire",
      rolled: 8,
      total: 10,
      multiplier: "double",
      raw: 20,
    });
    expect(g2?.raw).toBe(13);
    expect(w?.raw).toBe(0);
    expect(w?.damageParts?.[0]?.raw).toBe(0);
    const dm = lines(t, hpChangeIds[0] as string).dm;
    expect(dm).toContain("+ 20 fire (double) (DM set; rolled 8) (2d6: 2 + 6) damage");
  });

  test("FR-CBT-82 more part totals or multipliers than the card has → invalid; a card without parts takes none", () => {
    const t = flameTongue({ rage: false });
    const { cardId } = t.step3();
    const goblin = { targetId: t.id("Goblin"), hit: true, multiplier: "normal" };
    expect(() => t.apply(cardId, [goblin], { extraTotals: [1, 2] })).toThrow(
      "More part totals than the card has",
    );
    expect(() => t.apply(cardId, [{ ...goblin, extraMultipliers: ["half", "half"] }])).toThrow(
      "More part multipliers than the card has",
    );
    const greataxe = t.seeded<AttackResult>(
      attackCommand.name,
      { attackerId: t.id("Brakka"), manual: [{ diceTotal: 14 }, { diceTotal: 6 }] },
      t.p1,
    ).cardId;
    expect(() => t.apply(greataxe, [{ ...goblin, extraMultipliers: ["half"] }])).toThrow(
      "More part multipliers than the card has",
    );
  });
});

const lines = (t: ReturnType<typeof flameTongue>, id: string) => t.lines(id);

describe("FR-CBT-83 crit doubles every part", () => {
  test("FR-CBT-83 natural 20: 4d6+5 slashing + 4d6 fire + Divine Fury 2d6+2; manual entries checked per part", () => {
    const t = flameTongue();
    expect(() => t.attack([{ diceTotal: 20 }, { diceTotal: 12 }], [{ diceTotal: 3 }])).toThrow(
      "Dice total must be 4–24",
    );
    const { cardId } = t.attack([{ diceTotal: 20 }, { diceTotal: 12 }], [{ diceTotal: 14 }]);
    const p = t.card(cardId);
    expect(p.crit).toBe(true);
    const rows = (id: string) => t.s.db.select().from(roll).where(eq(roll.id, id)).get();
    expect(rows(p.damage?.rollId as string)?.expression).toBe("4d6+5");
    expect(rows(p.damage?.extra?.[0]?.rollId as string)?.expression).toBe("4d6");
    expect(rows(p.damage?.extra?.[0]?.rollId as string)?.label).toBe(
      "Flame Tongue greatsword damage (fire, critical)",
    );
    expect(rows(t.fury(cardId)?.rollId as string)?.expression).toBe("2d6+2");
    expect(t.note(cardId)?.text).toStartWith(
      "Brakka: 28 to hit (natural 20), 19 slashing + 14 fire (critical)",
    );
  });
});

describe("FR-CBT-84 outcome line parts", () => {
  test("FR-CBT-84 line payload damageParts [fire 4 half]; text '15 slashing + 4 fire (half) damage + N radiant (Divine Fury)'; extra dice only in dmPayload.rolls.extra; rollIds", () => {
    const t = flameTongue();
    const { cardId } = t.step3();
    const v = t.fury(cardId)?.value as number;
    const { hpChangeIds } = t.apply(cardId, [
      {
        targetId: t.id("Goblin"),
        hit: true,
        multiplier: "normal",
        extraMultipliers: ["half"],
        triggers: [{ triggerId: t.furyId }],
      },
    ]);
    const id = hpChangeIds[0] as string;
    const e = t.entryOf(id);
    const payload = e?.payload as AttackLogPayload;
    expect(payload.damageParts).toEqual([{ type: "fire", value: 4, multiplier: "half" }]);
    expect(payload.damage).toBe(15 + 4 + v);
    const dm = e?.dmPayload as AttackLogDmPayload;
    expect(dm.rolls?.extra).toEqual([
      {
        type: "fire",
        expression: "2d6",
        dice: [
          [2, true],
          [6, true],
        ],
        constant: 0,
        rolled: 8,
      },
    ]);
    const extraId = t.card(cardId).damage?.extra?.[0]?.rollId as string;
    expect(e?.rollIds as string[]).toContain(extraId);
    const l = t.lines(id);
    expect(l.players).toBe(
      `Brakka attacks Goblin: 14 + 8 = 22 — DM: hit. 15 slashing + 4 fire (half) damage + ${v} radiant (Divine Fury) (1d6+2: ${v - 2} + 2) (physical)`,
    );
    expect(l.dm).toContain("+ 4 fire (half) (2d6: 2 + 6) damage");
    // No extra-part dice in the players' copy (rulings B4).
    expect(JSON.stringify(payload)).not.toContain("2d6");
  });

  test("FR-CBT-84 a miss: no damageParts on the line; the row keeps them with raw 0", () => {
    const t = flameTongue({ rage: false });
    const { cardId } = t.step3();
    const { hpChangeIds } = t.apply(cardId, [
      { targetId: t.id("Goblin"), hit: false, multiplier: "normal" },
    ]);
    const e = t.entryOf(hpChangeIds[0] as string);
    expect((e?.payload as AttackLogPayload | undefined)?.damageParts).toBeUndefined();
    expect(t.row(hpChangeIds[0] as string)?.damageParts?.[0]?.raw).toBe(0);
    expect(t.lines(hpChangeIds[0] as string).players).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 (physical) — DM: miss",
    );
  });
});

describe("FR-CBT-82 undo and re-apply", () => {
  test("FR-CBT-82 undo reopens the card with its parts; re-applied to Goblin 2 (no ward) the fire part lands Normal", () => {
    const t = flameTongue({ rage: false });
    const { cardId } = t.step3();
    const first = t.apply(cardId, [
      { targetId: t.id("Goblin"), hit: true, multiplier: "normal", extraMultipliers: ["half"] },
    ]).hpChangeIds[0] as string;
    t.run(undoCommand.name, { expectedHpChangeId: first });
    expect(t.row(first)?.undone).toBe(true);
    expect(t.note(cardId)?.state).toBe("pending");
    expect(t.card(cardId).damage?.extra?.[0]?.total).toBe(8);
    const again = t.apply(cardId, [
      { targetId: t.id("Goblin 2"), hit: true, multiplier: "normal", extraMultipliers: ["normal"] },
    ]).hpChangeIds[0] as string;
    expect(t.row(again)?.raw).toBe(13 + 8);
    expect(t.lines(again).players).toContain("13 slashing + 8 fire damage");
  });
});

describe("FR-CBT-82 crash", () => {
  test("FR-CBT-82 crash: hard kill before commit → no HP, use row or damageParts; after commit → all of them", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = flameTongue();
    const { cardId } = t.step3();
    const target = {
      targetId: t.id("Goblin"),
      hit: true,
      multiplier: "normal",
      extraMultipliers: ["half"],
      triggers: [{ triggerId: t.furyId }],
    };
    const state = () => ({
      rows: t.s.db.select().from(hpChange).all().length,
      used: t.usesOf(t.furyId).filter((u) => u.state === "used").length,
      card: t.note(cardId)?.state,
    });
    try {
      armCrashHook({ point: "before-commit", target: applyCard.name }, kill);
      expect(() => t.apply(cardId, [target])).toThrow();
      expect(state()).toEqual({ rows: 0, used: 0, card: "pending" });
      armCrashHook({ point: "after-commit", target: applyCard.name }, kill);
      expect(() => t.apply(cardId, [target])).toThrow(Killed);
    } finally {
      armCrashHook(null);
    }
    expect(state()).toEqual({ rows: 1, used: 1, card: "resolved" });
    expect(t.s.db.select().from(hpChange).get()?.damageParts?.[0]?.raw).toBe(4);
  });
});
