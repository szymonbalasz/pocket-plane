import { describe, expect, test } from "bun:test";
import { attackLogKind } from "@shared/combat-tracker/log-kinds";
import { critExpression, rawDamage } from "@shared/combat-tracker/rules";
import {
  type AttackResult,
  COMBATANT_TYPE,
  DamageCardPayload,
  type HpChangeRecord,
  type HpChangesResult,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { jsonBytes, type NotificationRecord } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import { gameLogEntry, hpChange, notification } from "../../db/schema";
import { UPDATE } from "../entities/commands";
import { attackCommand } from "./attack";
import { applyCard, applyHp, undoCommand } from "./hp";
import { setInitiative, setRemoved } from "./initiative";
import { endCommand, startCommand } from "./lifecycle";
import { combatSetup, eliteBlock } from "./testing";

function started() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const card = (cardId: string) =>
    t.s.db.select().from(notification).where(eq(notification.id, cardId)).get() as
      | (NotificationRecord & { payload: unknown })
      | undefined;
  const attack = (name: string, toHit: number, damage: number, actor = t.h.dm, mode = "normal") =>
    t.run<AttackResult>(
      attackCommand.name,
      { attackerId: id(name), mode, manual: [{ diceTotal: toHit }, { diceTotal: damage }] },
      actor,
    );
  type TargetOpts = { hit?: boolean; multiplier?: string };
  /** Apply to targets by name; `o` = shared overrides plus `hit` / `multiplier` for every target. */
  const applyTo = (
    cardId: string,
    targets: readonly (string | [string, TargetOpts])[],
    o: Record<string, unknown> = {},
  ) => {
    const p = DamageCardPayload.parse(card(cardId)?.payload);
    const { hit = true, multiplier = "normal", ...shared } = o;
    return t.run<HpChangesResult>(applyCard.name, {
      cardId,
      toHitTotal: p.toHit.total,
      damageTotal: p.damage.total,
      targets: targets.map((x) => {
        const [name, per] = typeof x === "string" ? [x, {}] : x;
        return { targetId: id(name), hit, multiplier, ...per };
      }),
      ...shared,
    });
  };
  const apply = (cardId: string, target: string, o: Record<string, unknown> = {}) =>
    applyTo(cardId, [target], o);
  const hpRows = () => t.s.db.select().from(hpChange).all() as HpChangeRecord[];
  const entry = (eid: string) =>
    t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, eid)).get();
  const undo = () => {
    const last = hpRows()
      .filter((r) => !r.undone)
      .sort((a, b) => b.seq - a.seq)[0];
    return t.run<HpChangesResult>(undoCommand.name, { expectedHpChangeId: last?.id ?? "x" });
  };
  return { ...t, enc, id, card, attack, apply, applyTo, hpRows, entry, undo };
}

const types = (t: ReturnType<typeof started>, from: number) =>
  t.events.slice(from).map((e) => e.event.type);

describe("FR-CBT-16 FR-CBT-17 FR-CBT-18 attack", () => {
  test("FR-CBT-18 player attack (Mira): public roll line + card to the player, Apply = DM", () => {
    const t = started();
    const n = t.events.length;
    const r = t.attack("Mira", 15, 4, t.p1);
    expect(types(t, n)).toEqual(["AttackRolled", "NotificationCreated"]);
    expect(t.events[n]?.event.payload).toEqual({ cardId: r.cardId, rollIds: r.rollIds });
    const line = t.events[n]?.event.changes[0]?.after as GameLogEntryRecord;
    expect(line).toMatchObject({ kind: "roll", category: "attack", public: true });
    expect(line.rollIds).toEqual(r.rollIds);
    const card = t.card(r.cardId);
    expect(card).toMatchObject({
      kind: "damage-card",
      audience: "player",
      audiencePlayerId: t.h.p1.id,
      actionRole: "dm",
      actionLabel: "Apply",
      state: "pending",
      text: "Mira: 19 to hit, 6 piercing",
    });
    const p = DamageCardPayload.parse(card?.payload);
    expect(p).toMatchObject({
      attackerName: "Mira",
      attackName: "Shortsword",
      crit: false,
      toHit: { total: 19, natural: 15, constant: 4, manual: true, dice: [[15, true]] },
      damage: { total: 6, constant: 2 },
    });
  });

  test("FR-CBT-18 FR-CBT-52 DM attack: one DM-only roll entry (#171); card audience dm", () => {
    const t = started();
    const n = t.events.length;
    const r = t.attack("Goblin", 10, 3);
    expect(
      t.events[n]?.event.changes.map((c) => [c.type, (c.after as GameLogEntryRecord).public]),
    ).toEqual([[GAME_LOG_ENTRY_TYPE, false]]);
    expect(t.card(r.cardId)).toMatchObject({ audience: "dm", audiencePlayerId: null });
  });

  test("FR-CBT-16 player: other PC forbidden, monster forbidden, hidden not_found; strict input", () => {
    const t = started();
    const code = (input: unknown) => t.err(() => t.run(attackCommand.name, input, t.p1)).code;
    expect(code({ attackerId: t.id("Thorn") })).toBe("forbidden");
    expect(code({ attackerId: t.id("Goblin") })).toBe("forbidden");
    expect(code({ attackerId: t.id("Wolf") })).toBe("not_found");
    expect(code({ attackerId: t.id("Mira"), targetId: t.id("Goblin") })).toBe("invalid");
    expect(code({ attackerId: t.id("Mira"), public: true })).toBe("invalid");
    t.run(setRemoved.name, { combatantId: t.id("Mira"), removed: true });
    expect(code({ attackerId: t.id("Mira") })).toBe("not_found");
    expect(t.count("notification")).toBe(0);
    expect(t.count("roll")).toBe(0);
  });

  test("FR-CBT-16 no weapon attack → conflict, nothing written", () => {
    const t = started();
    t.run(UPDATE, {
      id: t.eliteId,
      name: "Elite Goblin Warrior",
      statBlock: { ...eliteBlock, attacks: [] },
    });
    const e = t.err(() => t.run(attackCommand.name, { attackerId: t.id("Elite Goblin Warrior") }));
    expect(e).toMatchObject({ code: "conflict", message: "No weapon attack" });
    expect(t.count("roll")).toBe(0);
  });

  test("FR-CBT-16 FR-CBT-17 natural 20 → damage dice doubled; manual checked against it", () => {
    const t = started();
    expect(critExpression("1d6+2")).toBe("2d6+2");
    expect(critExpression("2d4+2")).toBe("4d4+2");
    const r = t.attack("Goblin", 20, 12);
    const p = DamageCardPayload.parse(t.card(r.cardId)?.payload);
    expect(p).toMatchObject({ crit: true, damage: { total: 14 } });
    expect(t.card(r.cardId)?.text).toContain("(critical)");
    // 12 on 1d6 without a crit → invalid, nothing written.
    const before = t.count("roll");
    expect(t.err(() => t.attack("Goblin", 19, 12)).code).toBe("invalid");
    expect(t.count("roll")).toBe(before);
    // Advantage: two d20s, the kept one is natural.
    const adv = t.run<AttackResult>(attackCommand.name, {
      attackerId: t.id("Goblin"),
      mode: "advantage",
    });
    const ap = DamageCardPayload.parse(t.card(adv.cardId)?.payload);
    expect(ap.toHit.dice).toHaveLength(2);
    expect(ap.mode).toBe("advantage");
  });

  test("FR-CBT-18 card payload ≤ 1 KB at 50 dice", () => {
    const die: [number, boolean] = [6, true];
    const p = DamageCardPayload.parse({
      encounterId: "e".repeat(36),
      attackerId: "a".repeat(36),
      attackerName: "n".repeat(40),
      attackName: "w".repeat(40),
      damageType: "bludgeoning",
      mode: "advantage",
      crit: true,
      toHit: {
        rollId: "r".repeat(36),
        dice: [die, [3, false]],
        constant: 30,
        total: 50,
        natural: 20,
        manual: false,
      },
      damage: {
        rollId: "d".repeat(36),
        dice: Array(48).fill([10, true]),
        constant: 30,
        total: 500,
        manual: false,
      },
    });
    expect(jsonBytes(p)).toBeLessThanOrEqual(1024);
  });
});

describe("FR-CBT-34 FR-CBT-22 FR-CBT-23 FR-CBT-24 apply", () => {
  test("FR-CBT-34 DM applies a card to Goblin: HP, combat log entry, line, card resolved", () => {
    const t = started();
    t.run("dice.setCategoryPublic", { category: "attack", public: true });
    const r = t.attack("Mira", 15, 4, t.p1);
    const n = t.events.length;
    const res = t.apply(r.cardId, "Goblin");
    expect(types(t, n)).toEqual(["AttackApplied", "NotificationResolved"]);
    expect(t.byName(t.enc.id).Goblin).toMatchObject({ hpCurrent: 1 });
    const row = t.hpRows()[0];
    expect(row).toMatchObject({
      id: res.hpChangeIds[0],
      kind: "damage",
      source: "card",
      cardId: r.cardId,
      rollIds: r.rollIds,
      attackerName: "Mira",
      targetName: "Goblin",
      targetAc: 15,
      toHitRolled: 19,
      toHitTotal: 19,
      natural: 15,
      hitComputed: true,
      hit: true,
      damageRolled: 6,
      damageTotal: 6,
      multiplier: "normal",
      raw: 6,
      applied: 6,
      overkill: 0,
      hpBefore: 7,
      hpAfter: 1,
      undone: false,
    });
    const ev = t.events[n]?.event;
    expect(ev?.payload).toMatchObject({ hpChangeId: res.hpChangeIds[0], applied: 6, targetAc: 15 });
    const e = t.entry(row?.entryId as string);
    expect(e).toMatchObject({ kind: "cbt.attack", category: "attack", public: true });
    expect(e?.encounterId).toBe(t.enc.id);
    expect(lineText(attackLogKind.formatLine({ actorName: "Mira", payload: e?.payload }))).toBe(
      "Mira attacks Goblin: 15 + 4 = 19 (physical) — hit! 6 piercing damage (physical)",
    );
    expect(t.card(r.cardId)).toMatchObject({
      state: "resolved",
      resolution: {
        targets: [{ targetName: "Goblin", hit: true, multiplier: "normal", applied: 6 }],
      },
    });
    // Players: band upsert, no HP numbers, no hp-change.
    const v = t.h.viewer("player", t.h.p2.id);
    const wire = (ev?.changes ?? []).map((c) => t.s.records.filterChange(c, v)).filter(Boolean);
    expect(wire.map((w) => w?.type)).toEqual([COMBATANT_TYPE, GAME_LOG_ENTRY_TYPE]);
    expect(JSON.stringify(wire)).not.toContain("hpCurrent");
    expect(JSON.stringify(wire)).not.toContain("dmPayload");
    expect(JSON.stringify(wire)).toContain('"band":"bloodied"');
  });

  test("FR-CBT-34 rolled values from the rows; overrides flagged; half rounds down; overkill", () => {
    const t = started();
    const r = t.attack("Goblin", 3, 5); // 7 to hit, 7 damage
    t.apply(r.cardId, "Wolf", {
      toHitTotal: 14,
      damageTotal: 7,
      multiplier: "half",
    });
    expect(t.hpRows()[0]).toMatchObject({
      toHitRolled: 7,
      toHitTotal: 14,
      hitComputed: true,
      raw: 3,
      applied: 3,
      hpBefore: 11,
      hpAfter: 8,
    });
    const e = t.entry(t.hpRows()[0]?.entryId as string);
    expect(e?.dmPayload).toMatchObject({ overrides: { toHit: true, hit: false, damage: false } });
    expect(e?.payload).toMatchObject({ toHit: { dice: null, total: 14 } });
    const r2 = t.attack("Goblin", 10, 6);
    t.apply(r2.cardId, "Goblin 2", { damageTotal: 30, multiplier: "double" });
    expect(t.hpRows()[1]).toMatchObject({ raw: 60, applied: 7, overkill: 53, hpAfter: 0 });
    expect([0, 1, 7, 9].map((d) => rawDamage(true, d, "half"))).toEqual([0, 0, 3, 4]);
    expect(rawDamage(false, 9, "double")).toBe(0);
    expect(rawDamage(true, 9, "none")).toBe(0);
  });

  test("FR-CBT-24 public rule: hidden attacker or target → false; DM card → category / override", () => {
    const t = started();
    const pub = (cardId: string) =>
      t.entry(t.hpRows().find((h) => h.cardId === cardId)?.entryId as string)?.public;
    const c1 = t.attack("Goblin", 10, 3);
    t.apply(c1.cardId, "Goblin 2");
    expect(pub(c1.cardId)).toBe(false); // category off by default
    const c2 = t.attack("Goblin", 10, 3);
    t.apply(c2.cardId, "Goblin 2", { public: true });
    expect(pub(c2.cardId)).toBe(true);
    const c3 = t.attack("Elite Goblin Warrior", 10, 3);
    t.apply(c3.cardId, "Goblin 2", { public: true });
    expect(pub(c3.cardId)).toBe(false);
    const c4 = t.attack("Goblin", 10, 3);
    t.apply(c4.cardId, "Wolf", { public: true });
    expect(pub(c4.cardId)).toBe(false);
    // Hidden target → resolution names nobody.
    expect(t.card(c4.cardId)?.resolution).toMatchObject({ targets: [{ targetName: null }] });
    const c5 = t.attack("Mira", 10, 3, t.p1);
    t.apply(c5.cardId, "Goblin", { public: false });
    expect(pub(c5.cardId)).toBe(true);
  });

  test("FR-CBT-34 double apply, ended, removed target, other campaign; rollback leaves nothing", () => {
    const t = started();
    const r = t.attack("Goblin", 10, 3);
    t.apply(r.cardId, "Goblin 2");
    expect(t.err(() => t.apply(r.cardId, "Goblin 2")).code).toBe("conflict");
    const r2 = t.attack("Goblin", 10, 3);
    t.run(setRemoved.name, { combatantId: t.id("Goblin 2"), removed: true });
    expect(t.err(() => t.apply(r2.cardId, "Goblin 2")).code).toBe("not_found");
    expect(
      t.err(() =>
        t.run(applyCard.name, {
          cardId: r2.cardId,
          toHitTotal: 1,
          damageTotal: 1,
          targets: [{ targetId: "nope", hit: true, multiplier: "normal" }],
        }),
      ).code,
    ).toBe("not_found");
    // Rollback: a failing apply (card of another kind) writes nothing.
    const rows = t.hpRows().length;
    const entries = t.count("game_log_entry");
    const other = t.run<{ id: string }>("note.testSend", { text: "x", actionLabel: "Go" });
    expect(
      t.err(() =>
        t.run(applyCard.name, {
          cardId: other.id,
          toHitTotal: 1,
          damageTotal: 1,
          targets: [{ targetId: t.id("Goblin"), hit: true, multiplier: "normal" }],
        }),
      ).code,
    ).toBe("not_found");
    expect(t.hpRows()).toHaveLength(rows);
    expect(t.count("game_log_entry")).toBe(entries);
    expect(t.card(r2.cardId)?.state).toBe("pending");
    t.run(endCommand.name, { encounterId: t.enc.id });
    const e = t.err(() => t.apply(r2.cardId, "Goblin"));
    expect(e).toMatchObject({ code: "conflict", message: "Encounter has ended" });
    // FR-CBT-59: End dismissed the pending card.
    expect(t.card(r2.cardId)?.state).toBe("dismissed");
    expect(t.err(() => t.run(applyCard.name, {}, t.p1)).code).toBe("forbidden");
  });
});

describe("FR-CBT-22 PC targets via characters.adjustHp", () => {
  const miraHp = (t: ReturnType<typeof started>) =>
    t.s.db.$client
      .query<{ hp: number }, [string]>("select hp_current as hp from entity where id = ?")
      .get(t.miraId)?.hp;

  test("FR-CBT-22 apply to Mira: character HP, entity change in the event; owner full, others no HP", () => {
    const t = started();
    const r = t.attack("Goblin", 15, 4); // 19 to hit vs AC 16, 6 damage
    t.apply(r.cardId, "Mira");
    expect(miraHp(t)).toBe(6);
    expect(t.hpRows()[0]).toMatchObject({
      targetAc: 16,
      hpBefore: 12,
      hpAfter: 6,
      applied: 6,
      targetEntityId: t.miraId,
    });
    const ev = t.events.find((e) => e.event.type === "AttackApplied")?.event;
    const ent = ev?.changes.find((c) => c.type === "entity");
    expect(ent?.id).toBe(t.miraId);
    const owner = t.s.records.filterChange(ent as never, t.h.viewer("player", t.h.p1.id));
    expect(owner?.data).toMatchObject({ hpCurrent: 6 });
    const other = t.s.records.filterChange(ent as never, t.h.viewer("player", t.h.p2.id));
    expect(JSON.stringify(other)).not.toContain("hpCurrent");
  });

  test("FR-CBT-25 undo after a sheet heal restores only its own delta, clamped (I2)", () => {
    const t = started();
    const r = t.attack("Goblin", 15, 4);
    t.apply(r.cardId, "Mira"); // 12 → 6
    t.run("char.adjustHp", { characterId: t.miraId, delta: 3 }, t.p1); // 9, not a combat log entry
    expect(t.hpRows()).toHaveLength(1);
    t.undo(); // +6 → 15, clamped 12
    expect(miraHp(t)).toBe(12);
    expect(t.card(r.cardId)?.state).toBe("pending");
  });

  test("FR-CBT-22 PC overkill; heal at full → no entity change, applied 0", () => {
    const t = started();
    t.run(applyHp.name, { combatantId: t.id("Thorn"), kind: "heal", amount: 5 });
    expect(t.hpRows()[0]).toMatchObject({ applied: 0, hpBefore: 10, hpAfter: 10 });
    expect(t.events.at(-1)?.event.changes.some((c) => c.type === "entity")).toBe(false);
    t.run(applyHp.name, { combatantId: t.id("Thorn"), kind: "damage", amount: 25 });
    expect(t.hpRows()[1]).toMatchObject({ applied: 10, overkill: 15, hpAfter: 0 });
  });
});

describe("FR-CBT-21 FR-CBT-25 direct HP and undo", () => {
  test("FR-CBT-21 direct damage / heal on a monster: clamped, cbt.hp entry, HpApplied", () => {
    const t = started();
    t.run(applyHp.name, { combatantId: t.id("Wolf"), kind: "damage", amount: 5 });
    expect(t.events.at(-1)?.event.type).toBe("HpApplied");
    t.run(applyHp.name, { combatantId: t.id("Wolf"), kind: "heal", amount: 50 });
    expect(t.byName(t.enc.id).Wolf?.hpCurrent).toBe(11);
    const [d, h] = t.hpRows();
    expect(d).toMatchObject({ kind: "damage", source: "direct", raw: 5, applied: 5, hpAfter: 6 });
    expect(h).toMatchObject({ kind: "heal", raw: 50, applied: 5, overkill: 0, hpAfter: 11 });
    expect(t.entry(h?.entryId as string)).toMatchObject({
      kind: "cbt.hp",
      category: "healing",
      public: false,
    });
    const code = (input: unknown) => t.err(() => t.run(applyHp.name, input)).code;
    expect(code({ combatantId: t.id("Wolf"), kind: "damage", amount: 0 })).toBe("invalid");
    expect(code({ combatantId: t.id("Wolf"), kind: "damage", amount: 1000 })).toBe("invalid");
  });

  test("FR-CBT-25 undo: strict LIFO, inverse clamped, entry struck, card reopened after", () => {
    const t = started();
    const r = t.attack("Goblin", 10, 3);
    t.apply(r.cardId, "Wolf"); // 11 → 6
    t.run(applyHp.name, { combatantId: t.id("Wolf"), kind: "damage", amount: 20 }); // → 0
    const [first, second] = t.hpRows();
    expect(
      t.err(() => t.run(undoCommand.name, { expectedHpChangeId: first?.id as string })).code,
    ).toBe("conflict");
    t.undo();
    expect(t.byName(t.enc.id).Wolf?.hpCurrent).toBe(6);
    expect(t.hpRows()[1]).toMatchObject({ id: second?.id, undone: true });
    expect(t.entry(second?.entryId as string)?.undone).toBe(true);
    const n = t.events.length;
    t.undo();
    expect(types(t, n)).toEqual(["CombatEntryUndone", "NotificationReopened"]);
    expect(t.events[n]?.event.payload).toEqual({ hpChangeId: first?.id });
    expect(t.byName(t.enc.id).Wolf?.hpCurrent).toBe(11);
    expect(t.card(r.cardId)).toMatchObject({ state: "pending", resolution: null });
    expect(t.err(() => t.undo()).message).toBe("Nothing to undo");
    // Re-apply the reopened card (no Redo).
    t.apply(r.cardId, "Wolf");
    expect(t.byName(t.enc.id).Wolf?.hpCurrent).toBe(6);
    // After End: nothing to undo; rows kept for stats.
    t.run(endCommand.name, { encounterId: t.enc.id });
    expect(t.err(() => t.undo()).message).toBe("Nothing to undo");
    expect(t.hpRows()).toHaveLength(3);
    expect(t.err(() => t.run(undoCommand.name, { expectedHpChangeId: "x" }, t.p1)).code).toBe(
      "forbidden",
    );
  });

  test("FR-CBT-25 CBT §13 step 12: cbt.undo after End → conflict 'Nothing to undo'; rows kept", () => {
    const t = started();
    t.run(applyHp.name, { combatantId: t.id("Wolf"), kind: "damage", amount: 3 });
    const last = t.hpRows()[0];
    t.run(endCommand.name, { encounterId: t.enc.id });
    const e = t.err(() => t.run(undoCommand.name, { expectedHpChangeId: last?.id as string }));
    expect(e).toMatchObject({ code: "conflict", message: "Nothing to undo" });
    expect(t.hpRows()).toEqual([expect.objectContaining({ id: last?.id, undone: false })]);
  });

  test("FR-CBT-14 a monster at 0 HP is skipped; FR-CBT-26 band down", () => {
    const t = started();
    for (const [n, v] of [
      ["Wolf", 18],
      ["Mira", 15],
      ["Goblin", 12],
      ["Goblin 2", 12],
      ["Thorn", 10],
      ["Elite Goblin Warrior", 8],
    ] as const) {
      t.run(setInitiative.name, { combatantId: t.id(n), value: v });
    }
    t.run(applyHp.name, { combatantId: t.id("Goblin"), kind: "damage", amount: 99 });
    const v = t.h.viewer("player", t.h.p1.id);
    const wire = (t.events.at(-1)?.event.changes ?? []).map((c) => t.s.records.filterChange(c, v));
    expect(wire[0]).toMatchObject({ type: COMBATANT_TYPE, data: { band: "down" } });
  });
});
