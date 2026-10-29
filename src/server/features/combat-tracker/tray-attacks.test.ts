// Sprint 15 (#385, ADR-0073) combat through the tray, in-process: staged parts on `cbt.attack` /
// `cbt.rollDamage` (FR-CBT-170), rowless rolls and the pending match (FR-CBT-171), and the DM's
// `cbt.useRoll` (FR-CBT-173, -175 event, -176 Dismiss). Visibility over sockets:
// `tray-attacks-sync.test.ts`.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import {
  type AttackResult,
  CARD_MODS_MAX,
  DamageCardPayload,
  type RollDamageResult,
  type UseRollResult,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import {
  type GameLogEntryRecord,
  isUsedRoll,
  RollEntryDmPayload,
  type RollEntryPayload,
} from "@shared/dice-roll-log/schemas";
import { RollUsed } from "@shared/events/combat-tracker";
import { jsonBytes } from "@shared/notifications/schemas";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { gameLogEntry, notification, roll } from "../../db/schema";
import type { Actor } from "../../events/types";
import { cbtxSetup } from "../combat-extras/testing";
import { gameLog } from "../dice-roll-log";
import { DAMAGE_CARD_PAYLOAD_MAX_BYTES, fitCardPayload } from "./card-kind";
import { setRemoved } from "./initiative";
import { combatSetup } from "./testing";

const I = CHARX_INTENTS;

/** Test-only: undo or supersede a plain entry (FR-DICE-19, -63) to check the refusals. */
const markEntry = defineCommand({
  name: "test.markEntry",
  input: z.object({ entryId: z.string(), how: z.enum(["undo", "supersede"]) }),
  execute({ entryId, how }, env) {
    if (how === "undo") gameLog.markUndone(env, entryId);
    else gameLog.supersede(env, entryId, entryId);
    return null;
  },
});

function setup() {
  const t = cbtxSetup();
  t.s.commands.register(markEntry);
  const flame = t.run<{ rowId: string }>(I.putRow, {
    creatureId: t.thornId,
    list: "attacks",
    row: {
      name: "Flame Tongue",
      toHit: 5,
      damage: "2d6+5",
      damageType: "slashing",
      extraDamage: [{ damage: "2d6", type: "fire" }],
    },
  }).rowId;
  const p1 = t.p1;
  const p2 = t.p2;
  const toHit = (attacker: string, d20: number, extra: object = {}, actor: Actor = p2) =>
    t.run<AttackResult>(
      "cbt.attack",
      { attackerId: t.id(attacker), rolls: "toHit", manual: [{ diceTotal: d20 }], ...extra },
      actor,
    );
  const damage = (attacker: string, extra: object = {}, actor: Actor = p2) =>
    t.run<RollDamageResult>("cbt.rollDamage", { attackerId: t.id(attacker), ...extra }, actor);
  const card = (cardId: string) => {
    const r = t.s.db.select().from(notification).where(eq(notification.id, cardId)).get();
    if (!r) throw new Error(`no card ${cardId}`);
    return { ...r, p: DamageCardPayload.parse(r.payload) };
  };
  const entry = (id: string) =>
    t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get() as
      | GameLogEntryRecord
      | undefined;
  const lastEntry = () =>
    t.s.db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all().at(-1) as
      | GameLogEntryRecord
      | undefined;
  const items = (id: string) => entry(id)?.payload as RollEntryPayload;
  const expressions = (ids: readonly string[]) =>
    ids.map((id) => t.s.db.select().from(roll).where(eq(roll.id, id)).get()?.expression);
  const diceRoll = (input: object, actor: Actor = t.h.dm) =>
    t.run<{ rollId: string; entryId: string }>("dice.roll", input, actor);
  const useRoll = (input: object, actor: Actor = t.h.dm) =>
    t.run<UseRollResult>("cbt.useRoll", input, actor);
  const written = () => [
    t.count("roll"),
    t.count("game_log_entry"),
    t.count("notification"),
    t.logTypes().length,
  ];
  return {
    ...t,
    flame,
    p1,
    p2,
    toHit,
    damage,
    card,
    entry,
    lastEntry,
    items,
    expressions,
    diceRoll,
    useRoll,
    written,
  };
}

describe("FR-CBT-170 staged parts on combat intents", () => {
  test("FR-CBT-170 staged parts on the card: staged to-hit and three damage parts; row ref, label and attackId kept", () => {
    const t = setup();
    const a = t.toHit("Thorn", 12, { attackId: t.flame, parts: [{ expression: "1d20+7" }] });
    expect(t.card(a.cardId).p.toHit?.total).toBe(19);
    expect(t.items(t.lastEntry()?.id as string)[0]).toMatchObject({
      label: "Flame Tongue attack",
      purpose: "attack",
      edited: true,
    });
    const d = t.damage("Thorn", {
      attackId: t.flame,
      parts: [
        { expression: "2d6+5", type: "slashing" },
        { expression: "2d6", type: "fire" },
        { expression: "1d8", type: "radiant" },
      ],
      manual: { diceTotal: 7 },
      manualExtra: [{ diceTotal: 6 }, { diceTotal: 4 }],
    });
    expect(d).toMatchObject({ cardId: a.cardId, attached: true });
    const p = t.card(a.cardId).p;
    expect(p.attackId).toBe(t.flame);
    expect(p.damageType).toBe("slashing");
    expect(p.damage?.total).toBe(12);
    expect(p.damage?.extra?.map((x) => [x.type, x.total])).toEqual([
      ["fire", 6],
      ["radiant", 4],
    ]);
    expect(t.card(a.cardId).text).toBe("Thorn: 19 to hit, 12 slashing + 6 fire + 4 radiant");
    const line = t.items(t.lastEntry()?.id as string);
    expect(line.map((i) => [i.purpose, i.part, i.edited ?? null])).toEqual([
      ["damage", { type: "slashing", extra: false }, null],
      ["damage", { type: "fire", extra: true }, null],
      ["damage", { type: "radiant", extra: true }, true],
    ]);
  });

  test("FR-CBT-170 staged parts: absent parts roll the row as before; parts with rolls both → invalid", () => {
    const t = setup();
    const a = t.toHit("Thorn", 12, { attackId: t.flame });
    const d = t.damage("Thorn", { attackId: t.flame });
    expect(d.attached).toBe(true);
    expect(t.expressions(d.rollIds)).toEqual(["2d6+5", "2d6"]);
    expect(t.card(a.cardId).p.damage?.extra).toHaveLength(1);
    const e = t.err(() =>
      t.run("cbt.attack", { attackerId: t.id("Thorn"), parts: [{ expression: "1d20+5" }] }, t.p2),
    );
    expect([e.code, e.issues?.[0]?.message]).toEqual([
      "invalid",
      "Staged parts roll the to-hit only",
    ]);
    const limits = t.err(() => t.damage("Thorn", { parts: [{ expression: "21d6" }] }));
    expect([limits.code, limits.issues?.[0]?.message]).toEqual([
      "invalid",
      "At most 20 damage dice",
    ]);
  });

  test("FR-CBT-170 crit doubles added dice: Flame Tongue 2d6+5 slashing + 3d6 fire on a natural 20 → 4d6+5 + 6d6", () => {
    const t = setup();
    const a = t.toHit("Thorn", 20, { attackId: t.flame });
    expect(t.card(a.cardId).p.crit).toBe(true);
    const d = t.damage("Thorn", {
      attackId: t.flame,
      parts: [
        { expression: "2d6+5", type: "slashing" },
        { expression: "3d6", type: "fire" },
      ],
    });
    expect(t.expressions(d.rollIds)).toEqual(["4d6+5", "6d6"]);
    const p = t.card(a.cardId).p;
    expect(p.damage?.dice).toHaveLength(4);
    expect(p.damage?.extra?.[0]?.dice).toHaveLength(6);
    expect(t.items(t.lastEntry()?.id as string).map((i) => i.label)).toEqual([
      "Flame Tongue damage (slashing, critical)",
      "Flame Tongue damage (fire, critical)",
    ]);
  });

  test("FR-CBT-170 manual against staged parts: one entry per staged part, doubled on a crit", () => {
    const t = setup();
    t.toHit("Thorn", 20, { attackId: t.flame });
    const parts = [
      { expression: "1d6+5", type: "slashing" },
      { expression: "1d8", type: "fire" },
      { expression: "1d4", type: "cold" },
    ];
    const before = t.written();
    // Two staged extra parts → two physical extra entries.
    const count = t.err(() =>
      t.damage("Thorn", {
        attackId: t.flame,
        parts,
        manual: { diceTotal: 7, dice: [3, 4] },
        manualExtra: [{ diceTotal: 9, dice: [4, 5] }],
      }),
    );
    expect([count.code, count.message]).toEqual(["invalid", "Enter 2 physical damage parts"]);
    // The crit doubles the staged base: 2d6, so one die is too few.
    const dice = t.err(() =>
      t.damage("Thorn", {
        attackId: t.flame,
        parts,
        manual: { diceTotal: 3, dice: [3] },
        manualExtra: [
          { diceTotal: 9, dice: [4, 5] },
          { diceTotal: 5, dice: [2, 3] },
        ],
      }),
    );
    expect(dice.code).toBe("invalid");
    expect(t.written()).toEqual(before);
    const ok = t.damage("Thorn", {
      attackId: t.flame,
      parts,
      manual: { diceTotal: 7, dice: [3, 4] },
      manualExtra: [
        { diceTotal: 9, dice: [4, 5] },
        { diceTotal: 5, dice: [2, 3] },
      ],
    });
    expect(t.expressions(ok.rollIds)).toEqual(["2d6+5", "2d8", "2d4"]);
  });

  test("FR-CBT-170 card fit at the cap: 20 staged dice doubled + 6 mods + offers ≤ 4 KB, weapon parts kept", () => {
    const id = (p: string) => `${p}-0000-0000-0000-000000000000`.slice(0, 36);
    const dice = (n: number) => Array.from({ length: n }, () => [12, true] as [number, boolean]);
    const cjk = (n: number) => "火".repeat(n);
    const mod = {
      label: cjk(40),
      value: -48,
      expression: "4d12",
      auto: true as const,
      rollId: id("r"),
    };
    const extra = (i: number, n: number) => ({
      type: "lightning" as const,
      rollId: id(`x${i}`),
      dice: dice(n),
      constant: 0,
      total: 480,
      manual: true,
    });
    // Σ 20 staged dice on a crit = 40 card dice; the worst split puts 36 on one extra part.
    const p = DamageCardPayload.parse({
      encounterId: id("e"),
      attackerId: id("a"),
      attackerName: cjk(40),
      attackName: cjk(40),
      damageType: "bludgeoning",
      mode: "advantage",
      crit: true,
      toHit: {
        rollId: id("h"),
        dice: [
          [20, true],
          [1, false],
        ],
        constant: 30,
        total: 99,
        manual: true,
        natural: 20,
        mods: Array(CARD_MODS_MAX).fill(mod),
      },
      damage: {
        rollId: id("d"),
        dice: dice(2),
        constant: 30,
        total: 999,
        manual: true,
        mods: Array(CARD_MODS_MAX).fill(mod),
        triggers: Array.from({ length: 4 }, (_, i) => ({
          triggerId: id(`t${i}`),
          label: "T".repeat(40),
          value: 999,
          expression: "20d12+20",
          rollId: id(`o${i}`),
          type: "radiant",
        })),
        extra: [extra(1, 36), extra(2, 2)],
      },
      attackId: id("att"),
    });
    const fit = fitCardPayload(p);
    expect(jsonBytes(fit)).toBeLessThanOrEqual(DAMAGE_CARD_PAYLOAD_MAX_BYTES);
    expect(fit.damage?.extra).toEqual(p.damage?.extra);
    expect(fit.damage?.triggers).toEqual(p.damage?.triggers);
    expect(DamageCardPayload.safeParse(fit).success).toBe(true);
  });
});

describe("FR-CBT-171 rowless attacks", () => {
  test("FR-CBT-171 rowless card: label or Attack / Damage, no attackId, no row on the subject; refusals", () => {
    const t = setup();
    const a = t.toHit("Thorn", 11, { rowless: true, parts: [{ expression: "1d20+9" }] });
    const p = t.card(a.cardId).p;
    expect([p.attackName, p.attackId, p.spellId, p.damageType]).toEqual([
      "Attack",
      undefined,
      undefined,
      null,
    ]);
    expect(t.card(a.cardId).text).toBe("Thorn: 20 to hit (Attack)");
    expect(t.items(t.lastEntry()?.id as string)[0]).toMatchObject({
      label: "Attack",
      purpose: "attack",
    });
    // A rowless damage-only card: the label names it, the first part's type types it.
    t.run("note.dismiss", { id: a.cardId }, t.h.dm);
    const d = t.damage("Thorn", {
      rowless: true,
      label: "Bottle of fire",
      parts: [{ expression: "2d6" }, { expression: "1d4", type: "fire" }],
    });
    const dp = t.card(d.cardId).p;
    expect(d.attached).toBe(false);
    expect([dp.attackName, dp.attackId, dp.damageType, dp.damage?.extra?.[0]?.type]).toEqual([
      "Bottle of fire",
      undefined,
      null,
      "fire",
    ]);
    const bad = (input: object) => t.err(() => t.damage("Thorn", input)).issues?.[0]?.message ?? "";
    expect(bad({ rowless: true })).toBe("A rowless roll needs parts");
    expect(bad({ rowless: true, attackId: t.flame, parts: [{ expression: "1d6" }] })).toBe(
      "A rowless roll names no row",
    );
    expect(bad({ label: "x", parts: [{ expression: "1d6" }] })).toBe(
      "A label only on a rowless roll",
    );
  });

  test("FR-CBT-171 match rules: row ↔ same row ✓, row ↔ rowless ✓ (both ways), two rows ✗", () => {
    const t = setup();
    const rowless = { rowless: true as const, parts: [{ expression: "1d6" }] };
    // Same row.
    const a = t.toHit("Thorn", 10, { attackId: t.flame });
    expect(t.damage("Thorn", { attackId: t.flame }).cardId).toBe(a.cardId);
    // Row to-hit, rowless damage.
    const b = t.toHit("Thorn", 10, { attackId: t.flame });
    expect(t.damage("Thorn", rowless)).toMatchObject({ cardId: b.cardId, attached: true });
    // Rowless to-hit, row damage.
    const c = t.toHit("Thorn", 10, { rowless: true, parts: [{ expression: "1d20+5" }] });
    expect(t.damage("Thorn", { attackId: t.flame })).toMatchObject({
      cardId: c.cardId,
      attached: true,
    });
    // Two rows: the Dagger's damage doesn't complete a Flame Tongue to-hit.
    const d = t.toHit("Thorn", 10, { attackId: t.flame });
    const dagger = t.damage("Thorn", {});
    expect(dagger.cardId).not.toBe(d.cardId);
    expect(dagger.attached).toBe(false);
    expect(t.card(d.cardId).p.damage).toBeNull();
  });
});

describe("FR-CBT-173 cbt.useRoll", () => {
  test("FR-CBT-173 use as attack: a player's 1d20+5 as Mira → Mira's to-hit-only card to that player, entry stamped, RollUsed", () => {
    const t = setup();
    const r = t.diceRoll(
      {
        expression: "1d20+5",
        manual: { diceTotal: 14 },
        actor: { entityId: t.miraId },
      },
      t.p1,
    );
    const res = t.useRoll({ entryId: r.entryId, as: "attack", attackerId: t.id("Mira") });
    expect(res.attached).toBe(false);
    const c = t.card(res.cardId);
    expect([c.audience, c.audiencePlayerId, c.state]).toEqual(["player", t.h.p1.id, "pending"]);
    expect(c.p).toMatchObject({
      attackerId: t.id("Mira"),
      attackName: "Attack",
      mode: "normal",
      crit: false,
      damage: null,
      toHit: { rollId: r.rollId, total: 19, natural: 14, constant: 5, manual: true },
    });
    expect(c.p.attackId).toBeUndefined();
    expect(c.text).toBe("Mira: 19 to hit (Attack)");
    const e = t.entry(r.entryId) as GameLogEntryRecord;
    expect(RollEntryDmPayload.parse(e.dmPayload).usedByCardId).toBe(res.cardId);
    expect(isUsedRoll(e)).toBe(true);
    const used = t.events.findLast((x) => x.event.type === RollUsed.type)?.event;
    expect(used?.payload).toEqual({
      entryId: r.entryId,
      cardId: res.cardId,
      encounterId: c.p.encounterId,
      as: "attack",
      attached: false,
    });
    expect(used?.changes.map((x) => x.type)).toEqual(["game-log-entry"]);
    expect(t.logTypes()).toContain("RollUsed");
  });

  test("FR-CBT-173 use as damage completes: the attacker's pending to-hit-only card (any row), type picked, a crit not doubled", () => {
    const t = setup();
    const before = t.count("roll");
    const a = t.toHit("Thorn", 20, { attackId: t.flame });
    const r = t.diceRoll({ expression: "1d8+1d6", manual: { diceTotal: 8, dice: [5, 3] } }, t.p2);
    const rolls = t.count("roll");
    const res = t.useRoll({
      entryId: r.entryId,
      as: "damage",
      attackerId: t.id("Thorn"),
      types: ["piercing"],
    });
    expect(res).toEqual({ cardId: a.cardId, attached: true });
    expect(t.count("roll")).toBe(rolls);
    expect(rolls - before).toBe(2);
    const p = t.card(a.cardId).p;
    expect(p.crit).toBe(true);
    expect(p.damageType).toBe("piercing");
    expect(p.damage).toMatchObject({
      rollId: r.rollId,
      total: 8,
      dice: [
        [5, true],
        [3, true],
      ],
    });
    expect(p.attackId).toBe(t.flame);
    const used = t.events.findLast((x) => x.event.type === RollUsed.type)?.event;
    expect(used?.changes.map((x) => x.type)).toEqual(["game-log-entry", "notification"]);
    expect((used?.payload as { attached?: boolean } | undefined)?.attached).toBe(true);
  });

  test("FR-CBT-173 use as damage alone: the DM's hidden 2d6 → Goblin 2's damage-only DM card; typed parts kept", () => {
    const t = setup();
    const r = t.diceRoll({ expression: "2d6", public: false });
    const res = t.useRoll({
      entryId: r.entryId,
      as: "damage",
      attackerId: t.id("Goblin 2"),
      types: ["bludgeoning"],
    });
    const c = t.card(res.cardId);
    expect([res.attached, c.audience, c.audiencePlayerId]).toEqual([false, "dm", null]);
    expect(c.p).toMatchObject({
      attackName: "Damage",
      damageType: "bludgeoning",
      toHit: null,
      crit: false,
    });
    expect(c.text).toMatch(/^Goblin 2: \d+ bludgeoning \(Damage\)$/);
    // Tagged damage parts: their own types; the base part may stay untyped.
    const two = t.diceRoll(
      {
        purpose: "damage",
        category: "damage",
        label: "Fire flask",
        parts: [{ expression: "1d8" }, { expression: "1d6", type: "fire" }],
      },
      t.p1,
    );
    const r2 = t.useRoll({ entryId: two.entryId, as: "damage", attackerId: t.id("Mira") });
    const p2 = t.card(r2.cardId);
    expect([p2.audience, p2.audiencePlayerId]).toEqual(["player", t.h.p1.id]);
    expect([p2.p.attackName, p2.p.damageType, p2.p.damage?.extra?.[0]?.type]).toEqual([
      "Fire flask",
      null,
      "fire",
    ]);
  });

  test("FR-CBT-173 idempotent: a second call → conflict 'Already used by a card', nothing written", () => {
    const t = setup();
    const r = t.diceRoll({ expression: "1d20+3" }, t.p1);
    t.useRoll({ entryId: r.entryId, as: "attack", attackerId: t.id("Mira") });
    const before = t.written();
    for (const as of ["attack", "damage"] as const) {
      const e = t.err(() => t.useRoll({ entryId: r.entryId, as, attackerId: t.id("Goblin") }));
      expect([e.code, e.message]).toEqual(["conflict", "Already used by a card"]);
    }
    expect(t.written()).toEqual(before);
  });

  test("FR-CBT-173 refusals: player, no encounter, unknown, not a roll, undone, rerolled, combat line, attacker, no d20, damage items, types", () => {
    const t = setup();
    const err = (input: object, actor: Actor = t.h.dm) => {
      const e = t.err(() => t.useRoll(input, actor));
      return [e.code, e.message];
    };
    const attack = (entryId: string, attacker = "Mira") => ({
      entryId,
      as: "attack",
      attackerId: t.id(attacker),
    });
    const damage = (entryId: string, types?: (string | null)[]) => ({
      entryId,
      as: "damage",
      attackerId: t.id("Mira"),
      ...(types ? { types } : {}),
    });
    const d20 = t.diceRoll({ expression: "1d20+5" }).entryId;
    const two = t.diceRoll({ expression: "2d6" }).entryId;
    expect(err(attack(d20), t.p1)[0]).toBe("forbidden");
    expect(err(attack("nope"))).toEqual(["not_found", "Log entry not found"]);
    t.run("cbt.applyHp", { combatantId: t.id("Goblin"), kind: "damage", amount: 1 });
    const hpLine = t.lastEntry() as GameLogEntryRecord;
    expect(hpLine.kind).not.toBe("roll");
    expect(err(attack(hpLine.id))).toEqual(["invalid", "Not a roll"]);
    const undone = t.diceRoll({ expression: "1d20" }).entryId;
    t.run("test.markEntry", { entryId: undone, how: "undo" });
    expect(err(attack(undone))).toEqual(["conflict", "That roll was undone or rerolled"]);
    const rerolled = t.diceRoll({ expression: "1d20" }).entryId;
    t.run("test.markEntry", { entryId: rerolled, how: "supersede" });
    expect(err(attack(rerolled))).toEqual(["conflict", "That roll was undone or rerolled"]);
    // Combat's own lines are used (FR-DICE-96: `encounterId`).
    t.toHit("Thorn", 12);
    const combatLine = t.lastEntry() as GameLogEntryRecord;
    expect(combatLine.encounterId).not.toBeNull();
    expect(err(attack(combatLine.id))).toEqual(["conflict", "Already used by a card"]);
    t.run(setRemoved.name, { combatantId: t.id("Goblin 2"), removed: true });
    expect(err(attack(d20, "Goblin 2"))).toEqual(["not_found", "Combatant not found"]);
    expect(err({ ...attack(d20), attackerId: "nobody" })[0]).toBe("not_found");
    expect(err(attack(two))).toEqual(["invalid", "Use as attack needs a d20"]);
    expect(err(damage(d20))).toEqual(["invalid", "Use as damage needs 1–3 damage rolls"]);
    const typed = t.diceRoll({
      purpose: "damage",
      parts: [
        { expression: "1d8", type: "piercing" },
        { expression: "1d6", type: "fire" },
      ],
    }).entryId;
    expect(err(damage(typed, ["slashing"]))).toEqual(["invalid", "That roll already has a type"]);
    const loose = t.diceRoll({ expression: "1d8" }).entryId;
    expect(err(damage(loose, ["fire", "cold"]))).toEqual(["invalid", "One type per damage roll"]);
    expect(err({ ...attack(d20), types: ["fire"] })[0]).toBe("invalid");
    // Nothing above stamped anything.
    for (const id of [d20, two, typed, loose]) {
      expect(isUsedRoll(t.entry(id) as GameLogEntryRecord)).toBe(false);
    }
  });

  test("FR-CBT-173 refusals: no started encounter → conflict", () => {
    const t = combatSetup();
    const r = t.run<{ entryId: string }>("dice.roll", { expression: "1d20+5" });
    const e = t.err(() =>
      t.run("cbt.useRoll", { entryId: r.entryId, as: "attack", attackerId: "x" }),
    );
    expect([e.code, e.message]).toEqual(["conflict", "No encounter is running"]);
  });

  test("FR-CBT-173 extra parts must end typed: an untyped second damage item → 'Pick a type for each extra part'", () => {
    const t = setup();
    // An old-style two-item entry without purpose: both items lack a natural → two damage items.
    const r = t.run<{ rollIds: string[]; entryId: string }>(
      "char.roll",
      { characterId: t.thornId, kind: "damage", attackId: t.flame },
      t.p2,
    );
    // Strip the tags so the entry reads as an old one: items without `part` are untyped.
    const e = t.entry(r.entryId) as GameLogEntryRecord;
    const plain = (e.payload as RollEntryPayload).map(({ part: _p, purpose: _u, ...i }) => i);
    t.s.db.update(gameLogEntry).set({ payload: plain }).where(eq(gameLogEntry.id, e.id)).run();
    const err = t.err(() =>
      t.useRoll({
        entryId: r.entryId,
        as: "damage",
        attackerId: t.id("Thorn"),
        types: ["slashing"],
      }),
    );
    expect([err.code, err.message]).toEqual(["invalid", "Pick a type for each extra part"]);
    const ok = t.useRoll({
      entryId: r.entryId,
      as: "damage",
      attackerId: t.id("Thorn"),
      types: ["slashing", "fire"],
    });
    expect(t.card(ok.cardId).p.damage?.extra?.[0]?.type).toBe("fire");
  });
});

describe("FR-CBT-176 undo, dismiss", () => {
  test("FR-CBT-176 Dismiss ends the card; the roll stays used", () => {
    const t = setup();
    const r = t.diceRoll({ expression: "1d20+5" }, t.p1);
    const res = t.useRoll({ entryId: r.entryId, as: "attack", attackerId: t.id("Mira") });
    t.run("note.dismiss", { id: res.cardId }, t.h.dm);
    expect(t.card(res.cardId).state).not.toBe("pending");
    expect(isUsedRoll(t.entry(r.entryId) as GameLogEntryRecord)).toBe(true);
    const e = t.err(() =>
      t.useRoll({ entryId: r.entryId, as: "attack", attackerId: t.id("Mira") }),
    );
    expect(e.message).toBe("Already used by a card");
    // A line of a used roll reads as before (the stamp is DM data only).
    const entry = t.entry(r.entryId) as GameLogEntryRecord;
    const line = lineText(
      formatEntry({ kind: "roll", actorName: entry.actorName, payload: entry.payload }).segments,
    );
    // Real dice: a natural 20 / 1 adds its marker.
    expect(line).toMatch(/^Player 1 — 1d20\+5: \d+ \+ 5 = \d+( — natural (20!|1))?$/);
  });
});
