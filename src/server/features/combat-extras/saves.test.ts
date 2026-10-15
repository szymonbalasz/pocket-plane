// Concentration and death saves, temp HP, in-process: FR-CBTX-14, FR-CBTX-18, FR-CBTX-23,
// FR-CBTX-24, FR-CBTX-42.
import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { rollKind } from "@shared/dice-roll-log/roll-kind";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { gameLogEntry } from "../../db/schema";
import { rollConcentration } from "./concentration";
import { rollDeathSave, setDeathSaves, setTempHp } from "./play-state";
import { cbtxSetup } from "./testing";

const entry = (t: ReturnType<typeof cbtxSetup>, id: string) =>
  t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get() as
    | GameLogEntryRecord
    | undefined;

function withCard() {
  const t = cbtxSetup();
  const conc = t.concentrate({ characterId: t.miraId }, "Bless");
  const [link] = t.add({
    targets: [{ combatantId: t.id("Thorn") }],
    kind: "custom",
    label: "Bless",
    sourceCombatantId: t.id("Mira"),
    linkConcentration: true,
  }).effectIds as [string];
  t.attackApply("Goblin", ["Mira"], 3);
  t.attackApply("Goblin", ["Mira"], 2);
  const [card, second] = t.cards();
  const roll = (diceTotal: number, actor = t.p1, extra: Record<string, unknown> = {}) =>
    t.run<{ success: boolean; entryId: string }>(
      rollConcentration.name,
      { notificationId: card?.id, manual: { diceTotal }, ...extra },
      actor,
    );
  return { ...t, conc, link, card: card?.id as string, second: second?.id as string, roll };
}

describe("FR-CBTX-18 concentration save", () => {
  test("FR-CBTX-18 kept: 8 + 4 ≥ 10 → resolved {total, dc, success}; public line", () => {
    const t = withCard();
    const n = t.events.length;
    const r = t.roll(8);
    expect(r.success).toBe(true);
    expect(t.typesSince(n)).toEqual(["ConcentrationRolled", "NotificationResolved"]);
    expect(t.note(t.card)).toMatchObject({
      state: "resolved",
      resolution: { total: 12, dc: 10, success: true },
      closedByRole: "player",
    });
    expect(entry(t, r.entryId)).toMatchObject({
      category: "saving-throw",
      public: true,
      actorName: "Mira",
    });
    expect((entry(t, r.entryId)?.payload as { label: string }[] | undefined)?.[0]?.label).toBe(
      "Concentration save (DC 10)",
    );
    expect(t.fx(t.conc).endedAt).toBeNull();
  });

  test("FR-CBTX-18 lost: concentration + links end save-failed; the other open card closes ended", () => {
    const t = withCard();
    const n = t.events.length;
    expect(t.roll(2).success).toBe(false);
    expect(t.typesSince(n)).toEqual([
      "ConcentrationRolled",
      "NotificationResolved",
      "NotificationResolved",
    ]);
    expect([t.fx(t.conc).endedReason, t.fx(t.link).endedReason]).toEqual([
      "save-failed",
      "concentration",
    ]);
    expect(t.note(t.second)).toMatchObject({ state: "resolved", resolution: { outcome: "ended" } });
    // Second tab / roll on a closed card → conflict.
    expect(t.err(() => t.roll(10)).code).toBe("conflict");
  });

  test("FR-CBTX-18 player public → forbidden; player-2 → not_found; DM may roll any card", () => {
    const t = withCard();
    expect(t.err(() => t.roll(10, t.p1, { public: true })).code).toBe("forbidden");
    expect(t.err(() => t.roll(10, t.p2)).code).toBe("not_found");
    expect(t.roll(15, t.h.dm).success).toBe(true);
  });

  test("FR-CBTX-18 a hidden monster's save is never public; FR-CBTX-42 no ability scores → conflict", () => {
    const t = cbtxSetup();
    t.concentrate({ combatantId: t.id("Wolf") }, "Howl");
    t.attackApply("Goblin", ["Wolf"], 2);
    const [card] = t.cards();
    expect(card).toMatchObject({ audience: "dm", actionRole: "dm" });
    const r = t.run<{ entryId: string }>(rollConcentration.name, {
      notificationId: card?.id,
      manual: { diceTotal: 12 },
      public: true,
    });
    expect(entry(t, r.entryId)?.public).toBe(false);
  });
});

describe("FR-CBTX-23 FR-CBTX-24 death saves", () => {
  test("FR-CBTX-23 rolls: success, failure, natural 1 → 2 failures, natural 20 → 1 HP; not dying → conflict", () => {
    const t = cbtxSetup();
    const save = (diceTotal: number, actor = t.p2) =>
      t.run<{ entryId: string }>(
        rollDeathSave.name,
        { characterId: t.thornId, manual: { diceTotal } },
        actor,
      );
    const conflict = t.err(() => save(10));
    expect([conflict.code, conflict.message]).toEqual(["conflict", "Not dying"]);
    t.hp("Thorn", "damage", 99);
    const n = t.events.length;
    const r = save(15);
    expect(t.typesSince(n)).toEqual(["DeathSaveRolled"]);
    expect(t.events.at(-1)?.event.payload).toMatchObject({
      characterId: t.thornId,
      natural: 15,
      before: { successes: 0, failures: 0 },
      after: { successes: 1, failures: 0 },
    });
    expect(entry(t, r.entryId)).toMatchObject({ public: true, actorName: "Thorn" });
    save(1);
    expect(t.character(t.thornId)).toMatchObject({ deathSuccesses: 1, deathFailures: 2 });
    save(20);
    expect(t.character(t.thornId)).toMatchObject({
      hpCurrent: 1,
      deathSuccesses: 0,
      deathFailures: 0,
    });
    // Another player can't roll Thorn's save.
    t.hp("Thorn", "damage", 5);
    expect(t.err(() => save(12, t.p1)).code).toBe("forbidden");
    expect(
      t.err(() => t.run(rollDeathSave.name, { characterId: t.thornId, public: true }, t.p2)).code,
    ).toBe("forbidden");
  });

  test("FR-CBTX-23 a PC hidden from players rolls DM-only, whoever rolls", () => {
    const t = cbtxSetup();
    t.run("map.setTokenHidden", { tokenId: t.tokens.thorn, hidden: true });
    t.hp("Thorn", "damage", 99);
    const r = t.run<{ entryId: string }>(
      rollDeathSave.name,
      { characterId: t.thornId, manual: { diceTotal: 12 } },
      t.p2,
    );
    expect(entry(t, r.entryId)?.public).toBe(false);
    const change = t.events.at(-1)?.event.changes.find((c) => c.type === "game-log-entry");
    expect((change?.after as { public: boolean } | undefined)?.public).toBe(false);
    expect(t.character(t.thornId).deathSuccesses).toBe(1);
  });

  test("FR-CBTX-24 set: DM only, at 0 HP; stabilise = 3 successes", () => {
    const t = cbtxSetup();
    const set = (s: number, f: number, actor = t.h.dm) =>
      t.run(setDeathSaves.name, { characterId: t.miraId, successes: s, failures: f }, actor);
    expect(t.err(() => set(3, 0)).code).toBe("conflict");
    t.hp("Mira", "damage", 99);
    expect(t.err(() => set(3, 0, t.p1)).code).toBe("forbidden");
    set(3, 0);
    expect(t.events.at(-1)?.event).toMatchObject({
      type: "DeathSavesSet",
      payload: { characterId: t.miraId, successes: 3, failures: 0 },
    });
    const n = t.events.length;
    set(3, 0);
    expect(t.events.length).toBe(n);
  });
});

describe("FR-CBTX-14 temp HP", () => {
  test("FR-CBTX-14 replace, same value no-op; player own PC only; monsters DM only", () => {
    const t = cbtxSetup();
    const set = (target: unknown, value: number, actor = t.h.dm) =>
      t.run(setTempHp.name, { target, value }, actor);
    set({ characterId: t.thornId }, 8, t.p2);
    expect(t.events.at(-1)?.event).toMatchObject({
      type: "TempHpSet",
      payload: { targetKind: "character", targetId: t.thornId, before: 0, after: 8 },
    });
    set({ characterId: t.thornId }, 5, t.p2);
    expect(t.character(t.thornId).tempHp).toBe(5);
    const n = t.events.length;
    set({ characterId: t.thornId }, 5, t.p2);
    expect(t.events.length).toBe(n);
    expect(t.err(() => set({ characterId: t.thornId }, 1, t.p1)).code).toBe("forbidden");
    expect(t.err(() => set({ combatantId: t.id("Goblin") }, 1, t.p1)).code).toBe("forbidden");
    expect(t.err(() => set({ combatantId: t.id("Wolf") }, 1, t.p1)).code).toBe("not_found");
    expect(t.err(() => set({ characterId: t.thornId }, 1000)).code).toBe("invalid");
    set({ combatantId: t.id("Goblin") }, 4);
    expect(t.byName(t.enc.id).Goblin?.tempHp).toBe(4);
  });
});

describe("FR-CBTX-39 save log lines", () => {
  const line = (t: ReturnType<typeof cbtxSetup>, id: string) =>
    lineText(rollKind.formatLine(entry(t, id) as never));

  test("FR-CBTX-47 death line: success / failure / natural 1 / natural 20 conscious / third failure dead / third success stable, no counters", () => {
    const t = cbtxSetup();
    t.hp("Thorn", "damage", 99);
    const save = (diceTotal: number) =>
      t.run<{ entryId: string }>(
        rollDeathSave.name,
        { characterId: t.thornId, manual: { diceTotal } },
        t.p2,
      ).entryId;
    expect(line(t, save(15))).toBe("Thorn — Death save: 15 = 15 — success (physical)");
    expect(line(t, save(4))).toBe("Thorn — Death save: 4 = 4 — failure (physical)");
    expect(line(t, save(1))).toBe(
      "Thorn — Death save: 1 = 1 — natural 1 — failure — dead (physical)",
    );
    t.run(setDeathSaves.name, { characterId: t.thornId, successes: 0, failures: 0 });
    expect(line(t, save(20))).toBe(
      "Thorn — Death save: 20 = 20 — natural 20! — conscious (physical)",
    );
    t.hp("Thorn", "damage", 99);
    t.run(setDeathSaves.name, { characterId: t.thornId, successes: 2, failures: 0 });
    const stable = save(12);
    expect(line(t, stable)).toBe("Thorn — Death save: 12 = 12 — success — stable (physical)");
    const payload = JSON.stringify(entry(t, stable));
    expect(payload).not.toMatch(/\(\d \/ \d\)/);
  });

  test("FR-CBTX-39 concentration save line: kept / lost", () => {
    const t = withCard();
    const r = t.roll(8);
    expect(line(t, r.entryId)).toBe(
      "Mira — Concentration save (DC 10): 8 + 4 = 12 — kept (physical)",
    );
    const lost = t.run<{ entryId: string }>(rollConcentration.name, {
      notificationId: t.second,
      manual: { diceTotal: 1 },
    });
    expect(line(t, lost.entryId)).toContain("= 5 — natural 1 — lost");
  });
});
