// `hpRules` through combat's apply / undo and the sheet's `char.adjustHp`, in-process:
// FR-CBTX-15 absorption, FR-CBTX-16 down ends concentration, FR-CBTX-17 cards, FR-CBTX-20 death
// failures, FR-CBTX-21 facts, FR-CBTX-22 undo (slots, death delta, cards), FR-CBTX-39 log line,
// crash before / after commit.
import { describe, expect, test } from "bun:test";
import { attackLogKind, hpLogKind } from "@shared/combat-tracker/log-kinds";
import { DamageCardTargetsResolution, type HpChangeRecord } from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { gameLogEntry } from "../../db/schema";
import { applyCard } from "../combat-tracker/hp";
import { rollDeathSave, setDeathSaves, setTempHp } from "./play-state";
import { cbtxSetup } from "./testing";

const entryOf = (t: ReturnType<typeof cbtxSetup>, row: HpChangeRecord) =>
  t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, row.entryId)).get() as
    | GameLogEntryRecord
    | undefined;

describe("FR-CBTX-15 FR-CBTX-17 FR-CBTX-22 apply + undo", () => {
  test("FR-CBTX-15/17/22 apply 2 targets (Goblin temp 3, Mira concentrating): absorption, one card to player-1; undo → temp 3, card undone", () => {
    const t = cbtxSetup();
    t.run(setTempHp.name, { target: { combatantId: t.id("Goblin") }, value: 3 });
    const conc = t.concentrate({ characterId: t.miraId }, "Bless");
    const n = t.events.length;
    const { cardId } = t.attackApply("Elite Goblin Warrior", ["Goblin", "Mira"], 5);
    // Per target: owner event → its cards; the damage card's resolution last.
    expect(t.typesSince(n)).toEqual([
      "AttackRolled",
      "NotificationCreated",
      "AttackApplied",
      "AttackApplied",
      "NotificationCreated",
      "NotificationResolved",
    ]);
    const [goblin, mira] = t.hpRows();
    // Elite's Scimitar 1d6+3, manual 5 → 8 damage.
    expect(goblin).toMatchObject({
      raw: 8,
      applied: 5,
      tempBefore: 3,
      tempAfter: 0,
      hpBefore: 7,
      hpAfter: 2,
      overkill: 0,
      noteIds: [],
      deathBefore: null,
    });
    expect(t.byName(t.enc.id).Goblin?.tempHp).toBe(0);
    const [card] = t.cards();
    expect(mira).toMatchObject({ raw: 8, applied: 8, hpAfter: 4, noteIds: [card?.id] });
    expect(card).toMatchObject({
      audience: "player",
      audiencePlayerId: t.h.p1.id,
      actionRole: "player",
      actionPlayerId: t.h.p1.id,
      actionLabel: "Roll save",
      text: "Mira: concentration save DC 10 (Bless)",
      state: "pending",
      payload: {
        effectId: conc,
        targetName: "Mira",
        dc: 10,
        damage: 8,
        hpChangeId: mira?.id,
        encounterId: t.enc.id,
      },
    });
    const applied = t.events.filter((e) => e.event.type === "AttackApplied").at(-1)?.event;
    expect(applied?.payload).toMatchObject({ noteIds: [card?.id], tempBefore: 0, tempAfter: 0 });
    // #138 / FR-CBTX-15: the rolling side sees damage dealt (HP lost + absorbed).
    const res = DamageCardTargetsResolution.parse(t.note(cardId)?.resolution);
    expect(res.targets.map((x) => x.applied)).toEqual([8, 8]);
    // FR-CBTX-39: "(3 absorbed by temp HP)" on the DM line only.
    const e = entryOf(t, goblin as HpChangeRecord) as GameLogEntryRecord;
    const dmLine = lineText(attackLogKind.formatLine({ ...e, dmPayload: e.dmPayload } as never));
    const playerLine = lineText(attackLogKind.formatLine({ ...e, dmPayload: null } as never));
    expect(dmLine).toContain("(3 absorbed by temp HP)");
    expect(playerLine).not.toContain("absorbed");
    // Undo the apply: temp back, Mira's card closed `undone`, the damage card reopened last.
    const m = t.events.length;
    expect(t.undo().notRestored).toEqual([]);
    expect(t.typesSince(m)).toEqual([
      "CombatEntryUndone",
      "NotificationResolved",
      "CombatEntryUndone",
      "NotificationReopened",
    ]);
    expect(t.byName(t.enc.id).Goblin).toMatchObject({ tempHp: 3, hpCurrent: 7 });
    expect(t.note(card?.id as string)).toMatchObject({
      state: "resolved",
      resolution: { outcome: "undone" },
    });
  });

  test("FR-CBTX-16 Mira to 0 → concentration + Bless end `down`; undo restores", () => {
    const t = cbtxSetup();
    const conc = t.concentrate({ characterId: t.miraId }, "Bless");
    const [link] = t.add({
      targets: [{ combatantId: t.id("Thorn") }],
      kind: "custom",
      label: "Bless",
      sourceCombatantId: t.id("Mira"),
      linkConcentration: true,
    }).effectIds as [string];
    const { hpChangeId } = t.hp("Mira", "damage", 20);
    expect([t.fx(conc), t.fx(link)].map((e) => [e.endedReason, e.endedByHpChangeId])).toEqual([
      ["down", hpChangeId],
      ["concentration", hpChangeId],
    ]);
    expect(t.cards()).toEqual([]);
    t.undo();
    expect([t.fx(conc).endedAt, t.fx(link).endedAt]).toEqual([null, null]);
  });

  test("FR-CBTX-22 concentration slot: down ends A, heal, concentrate on B, undo → A stays ended, notRestored, undo succeeds", () => {
    const t = cbtxSetup();
    const a = t.concentrate({ characterId: t.miraId }, "Bless");
    t.hp("Mira", "damage", 20);
    t.run("char.adjustHp", { characterId: t.miraId, delta: 5 }, t.p1);
    const b = t.concentrate({ characterId: t.miraId }, "Shield of Faith", undefined, t.p1);
    expect(t.undo().notRestored).toEqual(["Concentrating: Bless (Mira)"]);
    expect([t.fx(a).endedReason, t.fx(b).endedAt]).toEqual(["down", null]);
  });

  test("FR-CBTX-22 death delta: apply at 0 HP 1 / 0 → 1 / 1 → player rolls → 2 / 1 → undo → 2 / 0", () => {
    const t = cbtxSetup();
    t.hp("Thorn", "damage", 99);
    t.run(setDeathSaves.name, { characterId: t.thornId, successes: 1, failures: 0 });
    t.hp("Thorn", "damage", 3);
    const row = t.hpRows().at(-1);
    expect([row?.deathBefore, row?.deathAfter]).toEqual([
      { successes: 1, failures: 0 },
      { successes: 1, failures: 1 },
    ]);
    t.run(rollDeathSave.name, { characterId: t.thornId, manual: { diceTotal: 14 } }, t.p2);
    expect(t.character(t.thornId)).toMatchObject({ deathSuccesses: 2, deathFailures: 1 });
    t.undo();
    expect(t.character(t.thornId)).toMatchObject({
      hpCurrent: 0,
      deathSuccesses: 2,
      deathFailures: 0,
    });
  });

  test("FR-CBTX-20 crit at 0 HP → 2 failures; stable then damage → successes 0 + failure; heal resets; overkill after temp", () => {
    const t = cbtxSetup();
    t.run(setTempHp.name, { target: { characterId: t.thornId }, value: 4 });
    t.hp("Thorn", "damage", 20);
    // Thorn 10 HP + 4 temp: 20 → absorbed 4, 16 HP loss → overkill 6.
    expect(t.hpRows().at(-1)).toMatchObject({
      applied: 10,
      overkill: 6,
      tempBefore: 4,
      tempAfter: 0,
    });
    // Natural 20 to-hit → crit card (Goblin Scimitar crit 2d6+2, manual 6 → 8).
    t.attackApply("Goblin", ["Thorn"], 6, { toHit: 20 });
    expect(t.character(t.thornId)).toMatchObject({ deathSuccesses: 0, deathFailures: 2 });
    t.run(setDeathSaves.name, { characterId: t.thornId, successes: 3, failures: 0 });
    t.hp("Thorn", "damage", 1);
    expect(t.character(t.thornId)).toMatchObject({ deathSuccesses: 0, deathFailures: 1 });
    t.hp("Thorn", "heal", 2);
    expect(t.character(t.thornId)).toMatchObject({
      hpCurrent: 2,
      deathSuccesses: 0,
      deathFailures: 0,
    });
    // FR-CBTX-39 on `cbt.hp` too.
    t.run(setTempHp.name, { target: { combatantId: t.id("Wolf") }, value: 2 });
    t.hp("Wolf", "damage", 5);
    const e = entryOf(t, t.hpRows().at(-1) as HpChangeRecord) as GameLogEntryRecord;
    expect(lineText(hpLogKind.formatLine(e as never))).toBe(
      "DM — Wolf takes 5 damage (2 absorbed by temp HP)",
    );
  });
});

describe("FR-CBTX-02 char.adjustHp through hpRules", () => {
  test("FR-CBTX-02 sheet damage: temp absorbs, concentration card, failure at 0; facts in CharacterHpAdjusted", () => {
    const t = cbtxSetup();
    t.run(setTempHp.name, { target: { characterId: t.miraId }, value: 2 }, t.p1);
    t.concentrate({ characterId: t.miraId }, "Bless", undefined, t.p1);
    const n = t.events.length;
    expect(t.run("char.adjustHp", { characterId: t.miraId, delta: -5 }, t.p1)).toEqual({
      hpBefore: 12,
      hpAfter: 9,
    });
    expect(t.typesSince(n)).toEqual(["CharacterHpAdjusted", "NotificationCreated"]);
    const [card] = t.cards();
    expect(t.events[n]?.event.payload).toEqual({
      entityId: t.miraId,
      delta: -5,
      hpBefore: 12,
      hpAfter: 9,
      tempBefore: 2,
      tempAfter: 0,
      noteIds: [card?.id],
    });
    expect(card?.payload).toMatchObject({ hpChangeId: null, encounterId: t.enc.id, damage: 5 });
    // Temp HP only: HP unchanged but temp changed → still an event.
    t.run(setTempHp.name, { target: { characterId: t.miraId }, value: 9 }, t.p1);
    t.run("char.adjustHp", { characterId: t.miraId, delta: -3 }, t.p1);
    expect(t.character(t.miraId)).toMatchObject({ hpCurrent: 9, tempHp: 6 });
  });
});

describe("crash (ADR-0035): apply ⇔ temp ⇔ card ⇔ effects", () => {
  test("FR-CBTX-01 hard kill before commit → nothing; after commit → card, temp, effects all there", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = cbtxSetup();
    t.run(setTempHp.name, { target: { combatantId: t.id("Goblin") }, value: 3 });
    t.concentrate({ characterId: t.miraId }, "Bless");
    const thorn = t.concentrate({ characterId: t.thornId }, "Hex");
    try {
      armCrashHook({ point: "before-commit", target: applyCard.name }, kill);
      expect(() => t.attackApply("Elite Goblin Warrior", ["Goblin", "Mira", "Thorn"], 6)).toThrow();
      expect(t.byName(t.enc.id).Goblin?.tempHp).toBe(3);
      expect(t.cards()).toEqual([]);
      expect(t.hpRows()).toEqual([]);
      armCrashHook({ point: "after-commit", target: applyCard.name }, kill);
      // A fresh card: the first one is still pending.
      expect(() => t.attackApply("Elite Goblin Warrior", ["Goblin", "Mira", "Thorn"], 6)).toThrow(
        Killed,
      );
    } finally {
      armCrashHook(null);
    }
    // 9 damage: Goblin temp gone, Mira's card pending, Thorn (10 HP) at 1 → card too.
    expect(t.byName(t.enc.id).Goblin?.tempHp).toBe(0);
    expect(t.cards().map((c) => [c.text, c.state])).toEqual([
      ["Mira: concentration save DC 10 (Bless)", "pending"],
      ["Thorn: concentration save DC 10 (Hex)", "pending"],
    ]);
    expect(t.fx(thorn).endedAt).toBeNull();
    expect(t.hpRows()).toHaveLength(3);
  });
});
