// GEM GM1 integration (in-process): the Inspiration reroll (FR-GEM-18–24) on dice-roll-log's
// reroll + supersede (FR-DICE-62–67), the target detail by audience (FR-GEM-13, DM-SECRET-GEM
// leak scan), the card following a combat to-hit (FR-GEM-22, FR-CBT-126/127/129), races, crash.
import { afterEach, describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { type DamageCardPayload, partRollIdsOf } from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { countedRollIds } from "@shared/dice-roll-log/reroll";
import type { DieResult, GameLogEntryRecord, RollPayloadItem } from "@shared/dice-roll-log/schemas";
import { GemSpent } from "@shared/events/gems";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { gameLogEntry, roll, triggerUse } from "../../db/schema";
import type { Actor } from "../../events/types";
import { setFeature } from "../campaign-management/features";
import { rollDeathSave } from "../combat-extras/play-state";
import { ALREADY_RULED } from "../combat-tracker/cards";
import { applyHitCommand } from "../combat-tracker/hit";
import { applyCard, CARD_CHANGED } from "../combat-tracker/hp";
import { s5Setup } from "../combat-tracker/s5-testing";
import { type RollHook, rollHooks } from "../dice-roll-log/roll-hooks";
import { adjustGems, GEMS_OFF, spendGem } from "./commands";
import { RULE_DRIVEN } from "./reroll";

afterEach(() => armCrashHook(null));

const SECRET = "DM-SECRET-GEM";

function setup() {
  const t = s5Setup();
  t.run(setFeature.name, { feature: GEMS_FEATURE, on: true });
  const award = (characterId: string, gem: string, delta: number) =>
    t.run(adjustGems.name, { characterId, gem, delta });
  award(t.miraId, "inspiration", 3);
  award(t.thornId, "inspiration", 1);
  /** `dice.roll` as Mira's (or another) entity; manual d20 (+ other dice) for exact totals. */
  const rollAs = (
    o: {
      expression?: string;
      label?: string;
      mode?: string;
      category?: string;
      dice?: number[];
      total?: number;
      entityId?: string;
      public?: boolean;
    } = {},
    actor: Actor = t.p1,
  ) => {
    const dice = o.dice ?? [4];
    return t.run<{ rollId: string; entryId: string }>(
      "dice.roll",
      {
        expression: o.expression ?? "1d20+3",
        label: o.label ?? "Perception",
        ...(o.mode ? { mode: o.mode } : {}),
        ...(o.category ? { category: o.category } : {}),
        actor: { entityId: o.entityId ?? t.miraId },
        manual: { diceTotal: o.total ?? dice.reduce((s, v) => s + v, 0), dice },
        ...(o.public !== undefined ? { public: o.public } : {}),
      },
      actor,
    );
  };
  let spends = 0;
  const spend = (
    entryId: string,
    o: { characterId?: string; manual?: object; key?: string } = {},
    actor: Actor = t.p1,
  ) =>
    t.run<{ held: number; entryId: string; rerollEntryId?: string }>(
      spendGem.name,
      {
        characterId: o.characterId ?? t.miraId,
        gem: "inspiration",
        entryId,
        ...(o.manual ? { manual: o.manual } : {}),
      },
      actor,
      o.key ?? `gm1-reroll-${++spends}`,
    );
  const entry = (id: string) =>
    t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get() as GameLogEntryRecord;
  const items = (id: string) => entry(id).payload as RollPayloadItem[];
  const rollRow = (id: string) => t.s.db.select().from(roll).where(eq(roll.id, id)).get();
  const text = (id: string, dm = true) => {
    const e = entry(id);
    return lineText(
      formatEntry({
        kind: e.kind,
        actorName: e.actorName,
        payload: e.payload,
        ...(dm ? { dmPayload: e.dmPayload } : {}),
        category: e.category,
      }).segments,
    );
  };
  const held = () =>
    (
      t.s.db.$client
        .query<{ n: number }, [string]>("SELECT inspiration AS n FROM character_gems WHERE id = ?")
        .get(t.miraId) ?? { n: 0 }
    ).n;
  return { ...t, rollAs, spend, entry, items, rollRow, text, held };
}

describe("FR-GEM-19 / FR-DICE-62–64 Inspiration reroll", () => {
  test("FR-GEM-19 reroll supersedes; FR-DICE-62 reroll d20 only; FR-DICE-63 supersede once; FR-DICE-64 reroll line", () => {
    const t = setup();
    const old = t.rollAs({ expression: "1d20+1d4+3", dice: [2, 3] });
    const n = t.events.length;
    const r = t.spend(old.entryId);
    expect(r.held).toBe(2);
    const newId = r.rerollEntryId as string;
    // The old entry: kept, superseded once; its roll row untouched.
    expect(t.entry(old.entryId).supersededBy).toBe(newId);
    expect(t.rollRow(old.rollId)?.replacesRollId).toBeNull();
    // The new roll: only the d20 new (seeded), the d4 and the constant copied.
    const [item] = t.items(newId) as [RollPayloadItem];
    const row = t.rollRow(item.rollId);
    expect(row?.replacesRollId).toBe(old.rollId);
    expect(row?.source).toBe("dice");
    expect(row?.manual).toBe(false);
    const dice = row?.dice as DieResult[];
    expect(dice[1]).toEqual({ faces: 4, value: 3, kept: true });
    expect(row?.constant).toBe(3);
    expect(row?.total).toBe((dice[0]?.value as number) + 3 + 3);
    expect(row?.natural).toBe(dice[0]?.value as number);
    expect(item.replaces).toEqual({ entryId: old.entryId, total: 8 });
    // Order: the spend line, then the new roll line (FR-GEM-19).
    expect(t.entry(r.entryId).n + 1).toBe(t.entry(newId).n);
    expect(t.text(r.entryId)).toBe("Mira spends an Inspiration gem — rerolls Perception (8)");
    expect(t.text(newId)).toContain("Mira — Perception (reroll, was 8): ");
    expect(t.entry(newId)).toMatchObject({
      public: true,
      rollerRole: "player",
      rollerPlayerId: t.h.p1.id,
      category: "other",
    });
    // One GemSpent naming every part (FR-GEM-12, GEM §9).
    const ev = t.events.slice(n).map((e) => e.event);
    expect(ev.map((e) => e.type)).toEqual([GemSpent.type]);
    expect(ev[0]?.payload).toEqual({
      characterId: t.miraId,
      gem: "inspiration",
      cost: 1,
      held: 2,
      entryId: r.entryId,
      rerollEntryId: newId,
      supersededEntryId: old.entryId,
      rollIds: [item.rollId],
    });
    // FR-DICE-63: a second reroll of the old line → conflict, nothing written (FR-GEM-37).
    const rows = t.count("game_log_entry");
    const e = t.err(() => t.spend(old.entryId));
    expect([e.code, e.message]).toEqual(["conflict", "Already rerolled"]);
    expect([t.count("game_log_entry"), t.held()]).toEqual([rows, 2]);
  });

  test("FR-DICE-62 adv both dice: both d20s new, kept recomputed; the mode kept", () => {
    const t = setup();
    const old = t.rollAs({ mode: "advantage", dice: [3, 5], total: 5 });
    const r = t.spend(old.entryId, { key: "gm1-adv" });
    const row = t.rollRow((t.items(r.rerollEntryId as string)[0] as RollPayloadItem).rollId);
    const dice = row?.dice as DieResult[];
    expect(row?.mode).toBe("advantage");
    expect(row?.expression).toBe("2d20kh1+3");
    expect(dice).toHaveLength(2);
    const top = Math.max(...dice.map((d) => d.value as number));
    expect(dice.filter((d) => d.kept)).toHaveLength(1);
    expect(dice.find((d) => d.kept)?.value).toBe(top);
    expect([row?.total, row?.natural]).toEqual([top + 3, top]);
  });

  test("FR-GEM-21 physical reroll: the new d20 typed (adv: both); bad dice → invalid", () => {
    const t = setup();
    const a = t.rollAs();
    const r = t.spend(a.entryId, { manual: { diceTotal: 17 } });
    const item = t.items(r.rerollEntryId as string)[0] as RollPayloadItem;
    expect([item.total, item.natural, item.manual]).toEqual([20, 17, true]);
    expect(t.text(r.rerollEntryId as string)).toBe(
      "Mira — Perception (reroll, was 7): 17 + 3 = 20 (physical)",
    );
    const adv = t.rollAs({ mode: "advantage", dice: [3, 5], total: 5 });
    const bad = (manual: object) => t.err(() => t.spend(adv.entryId, { manual })).code;
    expect(bad({ diceTotal: 17 })).toBe("invalid"); // adv: both dice needed
    expect(bad({ diceTotal: 17, dice: [17, 21] })).toBe("invalid");
    expect(bad({ diceTotal: 9, dice: [17, 5] })).toBe("invalid");
    const ok = t.spend(adv.entryId, { manual: { diceTotal: 17, dice: [5, 17] } });
    const row = t.rollRow((t.items(ok.rerollEntryId as string)[0] as RollPayloadItem).rollId);
    expect(row?.dice).toEqual([
      { faces: 20, value: 5, kept: false },
      { faces: 20, value: 17, kept: true },
    ]);
  });

  test("FR-GEM-20 second gem: the new line may be rerolled again; the first stays struck", () => {
    const t = setup();
    const a = t.rollAs();
    const first = t.spend(a.entryId, { manual: { diceTotal: 2 } });
    const second = t.spend(first.rerollEntryId as string, { manual: { diceTotal: 15 } });
    expect(t.entry(a.entryId).supersededBy).toBe(first.rerollEntryId as string);
    expect(t.entry(first.rerollEntryId as string).supersededBy).toBe(
      second.rerollEntryId as string,
    );
    const last = t.items(second.rerollEntryId as string)[0] as RollPayloadItem;
    expect(last.replaces).toEqual({ entryId: first.rerollEntryId as string, total: 5 });
    expect(t.held()).toBe(1);
  });

  test("FR-GEM-23 final value / FR-DICE-67 final roll: only the final roll counts, nat 20 once", () => {
    const t = setup();
    const a = t.rollAs({ dice: [20] });
    const r = t.spend(a.entryId, { manual: { diceTotal: 20 } });
    const entries = t.s.db.select().from(gameLogEntry).all() as GameLogEntryRecord[];
    const counted = countedRollIds(entries);
    const newRoll = (t.items(r.rerollEntryId as string)[0] as RollPayloadItem).rollId;
    expect(counted.has(a.rollId)).toBe(false);
    expect(counted.has(newRoll)).toBe(true);
    const nat20 = [...counted].filter((id) => t.rollRow(id)?.natural === 20);
    expect(nat20).toEqual([newRoll]);
  });

  test("FR-GEM-24 audience copied / FR-GEM-13 hidden target leak scan (DM-SECRET-GEM)", () => {
    const t = setup();
    const hidden = t.rollAs(
      { label: SECRET, category: "skill-check", dice: [6], public: false },
      t.h.dm,
    );
    expect(t.entry(hidden.entryId).public).toBe(false);
    // A player can't name a line they don't receive (GEM §11).
    expect(t.err(() => t.spend(hidden.entryId)).code).toBe("not_found");
    const n = t.events.length;
    const r = t.spend(hidden.entryId, {}, t.h.dm);
    const newId = r.rerollEntryId as string;
    expect(t.entry(newId)).toMatchObject({
      public: false,
      audiencePlayerId: null,
      rollerRole: "dm",
    });
    // The DM's line names the target; the public one doesn't.
    expect(t.text(r.entryId)).toBe(`Mira spends an Inspiration gem — rerolls ${SECRET} (9)`);
    expect(t.text(r.entryId, false)).toBe("Mira spends an Inspiration gem");
    expect(t.entry(r.entryId).public).toBe(true);
    for (const v of [t.p1V, t.p2V]) {
      // Snapshot: the spend line only, no label / totals.
      const snap = JSON.stringify(t.h.snapshot(v));
      expect(snap).not.toContain(SECRET);
      expect(snap).toContain(r.entryId);
      expect(snap).not.toContain(newId);
      // Frames: GemSpent's changes as this viewer gets them.
      const wire = t.events.slice(n).flatMap((e) => t.wire(e.event.changes, v));
      expect(JSON.stringify(wire)).not.toContain(SECRET);
      expect(wire.map((w) => w.id)).toEqual([t.miraId, r.entryId]);
    }
  });

  test("FR-DICE-62 audience copied: a companion line's `audiencePlayerId` is copied", () => {
    const t = setup();
    const a = t.rollAs();
    // A line stamped for player-1 only (as a companion's, ADR-0056), written directly.
    t.s.db
      .update(gameLogEntry)
      .set({ public: false, audiencePlayerId: t.h.p1.id })
      .where(eq(gameLogEntry.id, a.entryId))
      .run();
    const r = t.spend(a.entryId);
    expect(t.entry(r.rerollEntryId as string)).toMatchObject({
      public: false,
      audiencePlayerId: t.h.p1.id,
    });
    // Narrower than public: the detail goes to the DM's payload.
    expect(t.text(r.entryId, false)).toBe("Mira spends an Inspiration gem");
  });
});

describe("FR-GEM-18 eligibility", () => {
  test("FR-GEM-18 eligible: initiative, death / concentration saves, another's roll, no d20, undone, window ✗", () => {
    const t = setup();
    const code = (entryId: string, o: { characterId?: string } = {}, actor: Actor = t.p1) => {
      const e = t.err(() => t.spend(entryId, o, actor));
      return [e.code, e.message];
    };
    const init = t.rollAs({ label: "Initiative", category: "initiative" });
    expect(code(init.entryId)).toEqual(["conflict", "Initiative can't be rerolled"]);
    const dmg = t.rollAs({ expression: "2d6+2", dice: [3, 4], label: "Damage" });
    expect(code(dmg.entryId)).toEqual(["conflict", "No d20 roll to reroll"]);
    // Thorn's roll (player-2): not Mira's; Thorn isn't player-1's.
    const thorn = t.rollAs({ entityId: t.thornId }, t.p2);
    expect(code(thorn.entryId)).toEqual(["conflict", "Not Mira's roll"]);
    expect(code(thorn.entryId, { characterId: t.thornId })[0]).toBe("forbidden");
    // A roll as "Me" (the player) isn't the character's.
    const me = t.run<{ entryId: string }>(
      "dice.roll",
      { expression: "1d20", manual: { diceTotal: 4 } },
      t.p1,
    );
    expect(code(me.entryId)).toEqual(["conflict", "Not Mira's roll"]);
    // Death save (OQ-GEM-20 A): Thorn dying, player-2 rolls.
    t.hp("Thorn", "damage", 99);
    const death = t.run<{ entryId: string }>(
      rollDeathSave.name,
      { characterId: t.thornId, manual: { diceTotal: 14 } },
      t.p2,
    );
    expect(code(death.entryId, { characterId: t.thornId }, t.p2)).toEqual([
      "conflict",
      RULE_DRIVEN,
    ]);
    // Concentration save: Mira concentrating, hit, player-1 rolls the card.
    t.concentrate({ characterId: t.miraId }, "Bless");
    t.attackApply("Goblin", ["Mira"], 3);
    const [card] = t.cards();
    const conc = t.run<{ entryId: string }>(
      "cbtx.rollConcentration",
      { notificationId: card?.id, manual: { diceTotal: 12 } },
      t.p1,
    );
    expect(code(conc.entryId)).toEqual(["conflict", RULE_DRIVEN]);
    // Undone (a combat outcome's undo marks the roll line's sibling; here directly).
    const undone = t.rollAs();
    t.s.db
      .update(gameLogEntry)
      .set({ undone: true })
      .where(eq(gameLogEntry.id, undone.entryId))
      .run();
    expect(code(undone.entryId)).toEqual(["conflict", "Undone"]);
    // Window: 100 newer lines → too old.
    const oldest = t.rollAs();
    for (let i = 0; i < 100; i++) t.rollAs({ entityId: t.thornId }, t.p2);
    expect(code(oldest.entryId)).toEqual(["conflict", "Only the newest 100 lines can be rerolled"]);
    // Nothing spent by any of them.
    expect(t.held()).toBe(3);
  });

  test("FR-GEM-03 off refuses a reroll; FR-GEM-05 off hides gem traces (real reroll), on restores", () => {
    const t = setup();
    const a = t.rollAs();
    const r = t.spend(a.entryId);
    const ids = (v: typeof t.dmV) =>
      ((t.h.snapshot(v)["game-log-entry"] ?? []) as GameLogEntryRecord[]).map((e) => e.id);
    const replaces = (v: typeof t.dmV) =>
      JSON.stringify(t.h.snapshot(v)["game-log-entry"]).includes("replaces");
    for (const v of [t.dmV, t.p1V, t.p2V]) {
      expect(ids(v)).toEqual(expect.arrayContaining([a.entryId, r.entryId, r.rerollEntryId]));
      expect(replaces(v)).toBe(true);
    }
    t.run(setFeature.name, { feature: GEMS_FEATURE, on: false });
    for (const v of [t.dmV, t.p1V, t.p2V]) {
      expect(ids(v)).not.toContain(a.entryId);
      expect(ids(v)).not.toContain(r.entryId);
      expect(ids(v)).toContain(r.rerollEntryId as string);
      expect(replaces(v)).toBe(false);
    }
    const b = t.rollAs();
    const e = t.err(() => t.spend(b.entryId));
    expect([e.code, e.message]).toEqual(["forbidden", GEMS_OFF]);
    expect(t.entry(b.entryId).supersededBy).toBeNull();
    t.run(setFeature.name, { feature: GEMS_FEATURE, on: true });
    for (const v of [t.dmV, t.p1V, t.p2V]) {
      expect(ids(v)).toEqual(expect.arrayContaining([a.entryId, r.entryId, r.rerollEntryId]));
    }
  });

  test("FR-GEM-12 crash: gem.spend reroll before-commit → digest equal; after-commit → all of it", () => {
    const t = setup();
    const a = t.rollAs();
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const before = stateDigest(t.s.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: spendGem.name }, kill);
    expect(() => t.spend(a.entryId)).toThrow();
    armCrashHook(null);
    expect(stateDigest(t.s.db.$client).sha256).toBe(before);
    expect(t.entry(a.entryId).supersededBy).toBeNull();
    armCrashHook({ point: "after-commit", target: spendGem.name }, kill);
    expect(() => t.spend(a.entryId)).toThrow(Killed);
    armCrashHook(null);
    expect(t.entry(a.entryId).supersededBy).not.toBeNull();
    expect(t.held()).toBe(2);
  });
});

describe("FR-GEM-22 combat to-hits (FR-CBT-126, -127, -129)", () => {
  const cardOf = (t: ReturnType<typeof setup>, cardId: string) => t.card(cardId).p;
  const attackEntry = (t: ReturnType<typeof setup>, rollId: string) =>
    (t.s.db.select().from(gameLogEntry).all() as GameLogEntryRecord[]).find(
      (e) => e.kind === "roll" && e.rollIds.includes(rollId),
    ) as GameLogEntryRecord;

  test("FR-CBT-126 to-hit follows reroll / FR-GEM-22 card follows to-hit: new toHit, crit, NotificationUpdated no toast", () => {
    const t = setup();
    const { cardId } = t.toHit("Mira", 6);
    const before = t.card(cardId);
    const e = attackEntry(t, before.p.toHit?.rollId as string);
    const n = t.events.length;
    const r = t.spend(e.id, { manual: { diceTotal: 18 } });
    const after = t.card(cardId);
    const item = t.items(r.rerollEntryId as string)[0] as RollPayloadItem;
    expect(after.p.toHit).toMatchObject({ rollId: item.rollId, natural: 18, total: item.total });
    expect(after.p.crit).toBe(false);
    expect(after.seq).toBe(before.seq);
    expect(after.text).toBe(`Mira: ${item.total} to hit (${before.p.attackName})`);
    const types = t.events.slice(n).map((x) => x.event.type);
    expect(types).toEqual([GemSpent.type, "NotificationUpdated"]);
    expect(t.events.at(-2)?.event.payload).toMatchObject({ cardId });
    // FR-CBT-129: the popup's old to-hit id → conflict, nothing written; the new one applies.
    const hits = t.count("hit_ruling");
    const stale = t.err(() =>
      t.run(applyHitCommand.name, {
        cardId,
        toHitTotal: 15,
        targets: [t.target("Goblin", true)],
        partRollIds: partRollIdsOf(before.p),
      }),
    );
    expect([stale.code, stale.message, t.count("hit_ruling")]).toEqual([
      "conflict",
      CARD_CHANGED,
      hits,
    ]);
    t.applyHit(cardId, item.total, [t.target("Goblin", true)]);
    // FR-CBT-126: a ruled card no longer follows (and FR-GEM-18: the line isn't eligible).
    const again = t.err(() => t.spend(r.rerollEntryId as string));
    expect([again.code, again.message]).toEqual(["conflict", ALREADY_RULED]);
  });

  test("FR-CBT-129 stale apply: old to-hit / extra ids → conflict, nothing written; missing → invalid", () => {
    const t = setup();
    const a = t.run<{ cardId: string }>(
      "cbt.attack",
      { attackerId: t.id("Mira"), manual: [{ diceTotal: 9 }, { diceTotal: 4 }] },
      t.p1,
    );
    const old = cardOf(t, a.cardId);
    t.spend(attackEntry(t, old.toHit?.rollId as string).id, { manual: { diceTotal: 12 } });
    const p = cardOf(t, a.cardId);
    const input = (partRollIds: unknown) => ({
      cardId: a.cardId,
      toHitTotal: 15,
      damageTotal: 4,
      damageRollId: p.damage?.rollId ?? null,
      targets: [t.target("Goblin", true)],
      ...(partRollIds === undefined ? {} : { partRollIds }),
    });
    const rows = t.count("hp_change");
    const e = t.err(() => t.run(applyCard.name, input(partRollIdsOf(old))));
    expect([e.code, e.message]).toEqual(["conflict", CARD_CHANGED]);
    const x = t.err(() => t.run(applyCard.name, input({ toHit: p.toHit?.rollId, extra: ["r9"] })));
    expect([x.code, x.message]).toEqual(["conflict", CARD_CHANGED]);
    expect(t.err(() => t.run(applyCard.name, input(undefined))).code).toBe("invalid");
    expect(t.count("hp_change")).toBe(rows);
    t.run(applyCard.name, input(partRollIdsOf(p)));
    expect(t.count("hp_change")).toBe(rows + 1);
    // An applied attack can't be rerolled (FR-GEM-18).
    const done = attackEntry(t, p.toHit?.rollId as string);
    const d = t.err(() => t.spend(done.id));
    expect([d.code, d.message]).toEqual(["conflict", "The attack was already applied"]);
  });

  test("FR-CBT-127 crit flip: miss → natural 20 with damage: damage not used, card waits, next damage doubled", () => {
    const t = setup();
    const a = t.run<{ cardId: string }>(
      "cbt.attack",
      { attackerId: t.id("Mira"), manual: [{ diceTotal: 5 }, { diceTotal: 4 }] },
      t.p1,
    );
    const old = cardOf(t, a.cardId);
    expect(old.crit).toBe(false);
    const r = t.spend(attackEntry(t, old.toHit?.rollId as string).id, {
      manual: { diceTotal: 20 },
    });
    const p = cardOf(t, a.cardId);
    expect([p.crit, p.damage, p.toHit?.natural]).toEqual([true, null, 20]);
    expect(p.unusedRolls).toEqual([
      { rollId: old.damage?.rollId as string, total: old.damage?.total as number },
    ]);
    // The new line copies the damage item as rolled (FR-DICE-62); the card waits.
    expect((t.items(r.rerollEntryId as string)[1] as RollPayloadItem).rollId).toBe(
      old.damage?.rollId as string,
    );
    const dmg = t.damage("Mira", 9);
    expect(dmg.attached).toBe(true);
    const done = cardOf(t, a.cardId);
    const row = t.rollRow(done.damage?.rollId as string);
    // Mira's dagger 1d4 → 2d4 after the natural 20 (FR-CBT-16).
    expect(row?.expression.startsWith("2d")).toBe(true);
    expect(done.crit).toBe(true);
  });

  test("FR-CBT-127 crit flip: natural 20 → 9 with damage: same, the next damage not doubled", () => {
    const t = setup();
    const a = t.run<{ cardId: string }>(
      "cbt.attack",
      { attackerId: t.id("Mira"), manual: [{ diceTotal: 20 }, { diceTotal: 6 }] },
      t.p1,
    );
    const old = cardOf(t, a.cardId);
    expect(old.crit).toBe(true);
    t.spend(attackEntry(t, old.toHit?.rollId as string).id, { manual: { diceTotal: 9 } });
    const p: DamageCardPayload = cardOf(t, a.cardId);
    expect([p.crit, p.damage]).toEqual([false, null]);
    expect(p.unusedRolls?.map((u) => u.rollId)).toEqual([old.damage?.rollId as string]);
    t.damage("Mira", 3);
    const row = t.rollRow(cardOf(t, a.cardId).damage?.rollId as string);
    expect(row?.expression.startsWith("1d")).toBe(true);
    // No crit change: nothing moves.
    const b = t.run<{ cardId: string }>(
      "cbt.attack",
      { attackerId: t.id("Mira"), manual: [{ diceTotal: 7 }, { diceTotal: 2 }] },
      t.p1,
    );
    const bp = cardOf(t, b.cardId);
    t.spend(attackEntry(t, bp.toHit?.rollId as string).id, { manual: { diceTotal: 11 } });
    expect(cardOf(t, b.cardId).damage).toEqual(bp.damage);
  });

  test("FR-GEM-18 ruled card (walkthrough d2): Apply hit flags the owner's card `ruled` (no targets, no outcome); player-2 gets nothing", () => {
    const t = setup();
    const { cardId } = t.toHit("Mira", 6);
    const n = t.events.length;
    t.applyHit(cardId, 15, [t.target("Wolf", true)]);
    const cards = (v: typeof t.dmV) =>
      t.events
        .slice(n)
        .flatMap((x) => t.wire(x.event.changes, v))
        .filter((w) => w.type === "notification");
    const [own] = cards(t.p1V);
    expect((own?.data as { payload: DamageCardPayload }).payload.ruled).toBe(true);
    // The flag alone: the hidden Wolf, the ruling and its outcome stay DM-only.
    expect(JSON.stringify(own)).not.toContain(t.id("Wolf"));
    expect(JSON.stringify(own)).not.toContain("hit-ruling");
    expect(cards(t.p2V)).toEqual([]);
    expect((t.h.snapshot(t.p1V)["hit-ruling"] ?? []).length).toBe(0);
  });

  test("FR-GEM-22 leak: player-2 never gets player-1's card update; P1 does", () => {
    const t = setup();
    const { cardId } = t.toHit("Mira", 6);
    const e = attackEntry(t, t.card(cardId).p.toHit?.rollId as string);
    const n = t.events.length;
    t.spend(e.id, { manual: { diceTotal: 13 } });
    const updates = (v: typeof t.dmV) =>
      t.events
        .slice(n)
        .flatMap((x) => t.wire(x.event.changes, v))
        .filter((w) => w.type === "notification");
    expect(updates(t.p2V)).toEqual([]);
    expect(updates(t.p1V).map((w) => w.id)).toEqual([cardId]);
    expect(updates(t.dmV).map((w) => w.id)).toEqual([cardId]);
  });
});

describe("FR-GEM-19 no hook re-run (ADR-0043)", () => {
  test("FR-GEM-19 no hook re-run / FR-DICE-62 no hook re-run: roll hooks never called; a part's trigger doesn't fire again", () => {
    const t = setup();
    // A spy in the registry: a reroll must never call it.
    let calls = 0;
    const spy: RollHook = {
      id: "test.spy",
      adjust: () => {
        calls++;
        return { parts: [], modes: [] };
      },
    };
    (rollHooks as RollHook[]).push(spy);
    try {
      const a = t.rollAs();
      const base = calls;
      const uses = t.count("trigger_use");
      t.spend(a.entryId, { manual: { diceTotal: 20 } });
      expect(calls).toBe(base);
      expect(t.count("trigger_use")).toBe(uses);
    } finally {
      (rollHooks as RollHook[]).pop();
    }
    expect(t.s.db.select().from(triggerUse).all()).toEqual([]);
  });
});
