// Sprint 15 (#385, ADR-0073): `dice.roll` purpose and damage parts (FR-DICE-94); the DM-only
// used stamp `gameLog.markUsed` / `isUsedRoll` and its copy on a reroll (FR-DICE-96). In-process
// on CBTX's started ambush (the stamp comes from combat's `cbt.useRoll`).
import { describe, expect, test } from "bun:test";
import type { UseRollResult } from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import {
  type GameLogEntryRecord,
  isUsedRoll,
  RollEntryDmPayload,
  type RollEntryPayload,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { gameLogEntry, roll } from "../../db/schema";
import type { Actor } from "../../events/types";
import { cbtxSetup } from "../combat-extras/testing";
import { dice, gameLog } from "./index";
import type { OldEntry } from "./reroll";

/** Test-only: `gameLog.markUsed` directly (combat's caller is `cbt.useRoll`). */
const markUsedStep = defineCommand({
  name: "test.markUsed",
  input: z.object({ entryId: z.string(), cardId: z.string() }),
  execute({ entryId, cardId }, env) {
    return gameLog.markUsed(env, entryId, cardId).id;
  },
});

/** Test-only: `dice.reroll` of one roll, copying (or, `drop`, leaving out) the other items. */
const rerollStep = defineCommand({
  name: "test.reroll",
  input: z.object({ entryId: z.string(), rollId: z.string(), drop: z.boolean() }),
  execute({ entryId, rollId, drop }, env) {
    const r = dice.reroll(env, {
      entryId,
      rollId,
      ...(drop
        ? {
            others: (item: RollPayloadItem, old: OldEntry) => ({
              items: old.items.map(() => null),
              rollIds: [item.rollId],
            }),
          }
        : {}),
    });
    return r.entry.id;
  },
});

function setup() {
  const t = cbtxSetup();
  t.s.commands.register(markUsedStep);
  t.s.commands.register(rerollStep);
  const diceRoll = (input: object, actor: Actor = t.h.dm) =>
    t.run<{ rollId: string; entryId: string }>("dice.roll", input, actor);
  const entry = (id: string) =>
    t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get() as
      | GameLogEntryRecord
      | undefined;
  const items = (id: string) => entry(id)?.payload as RollEntryPayload;
  const line = (id: string) => {
    const e = entry(id) as GameLogEntryRecord;
    return lineText(
      formatEntry({ kind: e.kind, actorName: e.actorName, payload: e.payload }).segments,
    );
  };
  const expressions = (e: GameLogEntryRecord) =>
    e.rollIds.map((id) => t.s.db.select().from(roll).where(eq(roll.id, id)).get()?.expression);
  return { ...t, diceRoll, entry, items, line, expressions };
}

describe("FR-DICE-94 roll purpose", () => {
  test("FR-DICE-94 dice.roll purpose and parts: one roll row per part, one entry; purpose + part on each item; plain stays plain", () => {
    const t = setup();
    const dmg = t.diceRoll(
      {
        purpose: "damage",
        category: "damage",
        parts: [
          { expression: "2d6", type: "slashing" },
          { expression: "1d8", type: "fire" },
        ],
      },
      t.p1,
    );
    const e = t.entry(dmg.entryId) as GameLogEntryRecord;
    expect(t.expressions(e)).toEqual(["2d6", "1d8"]);
    expect(e.category).toBe("damage");
    expect(dmg.rollId).toBe(e.rollIds[0] as string);
    expect(t.items(dmg.entryId).map((i) => [i.purpose, i.part])).toEqual([
      ["damage", { type: "slashing", extra: false }],
      ["damage", { type: "fire", extra: true }],
    ]);
    // A part run: "Player 1 — damage: 2d6 (…) slashing + 1d8 (…) fire = N".
    expect(t.line(dmg.entryId)).toMatch(
      /^Player 1 — Damage: 2d6 \(.+\) slashing \+ 1d8 \(.+\) fire = \d+$/,
    );
    const attack = t.diceRoll(
      { purpose: "attack", category: "attack", expression: "1d20+9" },
      t.p1,
    );
    expect(t.items(attack.entryId).map((i) => [i.purpose, i.part ?? null])).toEqual([
      ["attack", null],
    ]);
    const one = t.diceRoll({ purpose: "damage", expression: "1d6+2" }, t.p1);
    expect(t.items(one.entryId)[0]).toMatchObject({
      purpose: "damage",
      part: { type: null, extra: false },
    });
    const plain = t.diceRoll({ expression: "1d20" }, t.p1);
    const [item] = t.items(plain.entryId);
    expect(["purpose" in (item ?? {}), "part" in (item ?? {})]).toEqual([false, false]);
    // Only the sender's category: the tray presets it, the server never derives it.
    expect(t.entry(attack.entryId)?.category).toBe("attack");
    expect(t.entry(one.entryId)?.category).toBe("other");
  });

  test("FR-DICE-94 purpose validation: expression xor parts, parts need damage, attack needs one d20, part limits", () => {
    const t = setup();
    const issue = (input: object) => {
      const e = t.err(() => t.diceRoll(input));
      return [e.code, e.issues?.[0]?.message];
    };
    expect(issue({ purpose: "damage" })).toEqual(["invalid", "An expression or parts"]);
    expect(issue({ purpose: "damage", expression: "1d6", parts: [{ expression: "1d6" }] })).toEqual(
      ["invalid", "An expression or parts"],
    );
    expect(issue({ parts: [{ expression: "1d6" }] })).toEqual([
      "invalid",
      "Parts are for damage rolls",
    ]);
    expect(issue({ purpose: "attack", parts: [{ expression: "1d20" }] })).toEqual([
      "invalid",
      "Parts are for damage rolls",
    ]);
    expect(issue({ purpose: "attack", expression: "2d6+3" })).toEqual([
      "invalid",
      "An attack needs one d20",
    ]);
    expect(issue({ purpose: "attack", expression: "1d20+1d20" })).toEqual([
      "invalid",
      "An attack needs one d20",
    ]);
    expect(issue({ purpose: "attack", expression: "2d20kh1+3" })).toEqual([
      "invalid",
      "An attack needs one d20",
    ]);
    expect(
      issue({ purpose: "damage", parts: [{ expression: "1d6" }, { expression: "1d6" }] }),
    ).toEqual(["invalid", "Pick a type for each extra part"]);
    expect(
      issue({
        purpose: "damage",
        parts: [{ expression: "15d6" }, { expression: "6d6", type: "fire" }],
      }),
    ).toEqual(["invalid", "At most 20 damage dice"]);
    expect(
      issue({
        purpose: "damage",
        parts: [{ expression: "1d6" }],
        manual: { diceTotal: 3 },
      }),
    ).toEqual(["invalid", "Physical dice: one expression"]);
    // Advantage stays FR-DICE-04's: an attack with adv rolls 2d20kh1.
    const adv = t.diceRoll({ purpose: "attack", expression: "1d20+4", mode: "advantage" });
    expect(t.expressions(t.entry(adv.entryId) as GameLogEntryRecord)).toEqual(["2d20kh1+4"]);
  });
});

describe("FR-DICE-96 used by a card", () => {
  test("FR-DICE-96 used stamp: set once in dmPayload (an entry without one gets per-item names), conflict on a second; isUsedRoll", () => {
    const t = setup();
    const r = t.diceRoll({ expression: "1d20+5" }, t.p1);
    const fresh = t.entry(r.entryId) as GameLogEntryRecord;
    expect([fresh.dmPayload, isUsedRoll(fresh)]).toEqual([null, false]);
    const used = t.run<UseRollResult>("cbt.useRoll", {
      entryId: r.entryId,
      as: "attack",
      attackerId: t.id("Mira"),
    });
    const after = t.entry(r.entryId) as GameLogEntryRecord;
    expect(RollEntryDmPayload.parse(after.dmPayload)).toEqual({
      items: [{ mods: [] }],
      usedByCardId: used.cardId,
    });
    expect(isUsedRoll(after)).toBe(true);
    // Players' copy has no dmPayload: isUsedRoll reads only `encounterId` there.
    expect(isUsedRoll({ encounterId: null })).toBe(false);
    expect(isUsedRoll({ encounterId: "enc" })).toBe(true);
    const e = t.err(() => t.run("test.markUsed", { entryId: r.entryId, cardId: "other" }));
    expect([e.code, e.message]).toEqual(["conflict", "Already used by a card"]);
    expect(RollEntryDmPayload.parse(t.entry(r.entryId)?.dmPayload).usedByCardId).toBe(used.cardId);
    // An entry with roll-hook names keeps them beside the stamp.
    const withNames = t.diceRoll({ expression: "1d20" });
    t.s.db
      .update(gameLogEntry)
      .set({ dmPayload: { items: [{ mods: [{ effectId: "fx", label: "Bless" }] }] } })
      .where(eq(gameLogEntry.id, withNames.entryId))
      .run();
    t.run("test.markUsed", { entryId: withNames.entryId, cardId: "card-x" });
    expect(t.entry(withNames.entryId)?.dmPayload).toEqual({
      items: [{ mods: [{ effectId: "fx", label: "Bless" }] }],
      usedByCardId: "card-x",
    });
  });

  test("FR-DICE-96 reroll keeps the stamp: a used entry's reroll is used too (copied and with `others`)", () => {
    const t = setup();
    const r = t.diceRoll({ expression: "1d20+5" }, t.p1);
    const used = t.run<UseRollResult>("cbt.useRoll", {
      entryId: r.entryId,
      as: "attack",
      attackerId: t.id("Mira"),
    });
    const copied = t.run<string>("test.reroll", {
      entryId: r.entryId,
      rollId: r.rollId,
      drop: false,
    });
    const next = t.entry(copied) as GameLogEntryRecord;
    expect(RollEntryDmPayload.parse(next.dmPayload).usedByCardId).toBe(used.cardId);
    expect(isUsedRoll(next)).toBe(true);
    const r2 = t.diceRoll({ expression: "1d20+2" }, t.p1);
    t.run("cbt.useRoll", { entryId: r2.entryId, as: "attack", attackerId: t.id("Mira") });
    const dropped = t.run<string>("test.reroll", {
      entryId: r2.entryId,
      rollId: r2.rollId,
      drop: true,
    });
    expect(isUsedRoll(t.entry(dropped) as GameLogEntryRecord)).toBe(true);
  });
});
