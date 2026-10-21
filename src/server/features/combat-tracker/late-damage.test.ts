// Sprint 5 R1 (late damage, ADR-0053): the late roll on a ruled card (FR-CBT-90 server side),
// the damage Apply after Apply hit (FR-CBT-91), the owner's second roll kept as unused
// (FR-CBT-92), rolls that can't join (FR-CBT-93), ordering and `damageRollId` (FR-CBT-94),
// offers on a late roll (FR-MOD-63). CBTX's ambush, round 1; `player-1` plays Mira.
import { describe, expect, test } from "bun:test";
import { AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import { resolutionText } from "@shared/combat-tracker/rules";
import {
  DAMAGE_CARD_KIND,
  DamageCardTargetsResolution,
  HIT_RULING_TYPE,
  type HpChangeRecord,
  type HpChangesResult,
  partRollIdsOf,
} from "@shared/combat-tracker/schemas";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { asc, eq, inArray } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { gameLogEntry, hpChange, notification } from "../../db/schema";
import { rtSetup } from "../effect-modifiers/trigger-testing";
import { applyHitCommand } from "./hit";
import { applyCard, DAMAGE_JUST_ARRIVED } from "./hp";
import { type S5Setup, s5Setup } from "./s5-testing";

type Target = { targetId: string; hit: boolean; multiplier: string };

/** The DM's damage Apply on a card, with the damage the card holds now (FR-CBT-94). */
const applyDamage = (t: S5Setup, cardId: string, targets: Target[], more: object = {}) => {
  const c = t.card(cardId).p;
  return t.run<HpChangesResult>(applyCard.name, {
    cardId,
    damageTotal: c.damage?.total,
    damageRollId: c.damage?.rollId ?? null,
    partRollIds: partRollIdsOf(c),
    targets,
    ...more,
  });
};

const hpRows = (t: S5Setup, ids: string[]) =>
  t.s.db
    .select()
    .from(hpChange)
    .where(inArray(hpChange.id, ids))
    .orderBy(asc(hpChange.seq))
    .all() as HpChangeRecord[];

const entryOf = (t: S5Setup, id: string) =>
  t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get() as GameLogEntryRecord;

const damageCards = (t: S5Setup) =>
  t.s.db
    .select()
    .from(notification)
    .where(eq(notification.kind, DAMAGE_CARD_KIND))
    .orderBy(asc(notification.seq))
    .all();

/** Every record change since event `n` as a viewer receives it, as JSON. */
const framesSince = (t: S5Setup, n: number, v: S5Setup["p1V"]) =>
  JSON.stringify(t.events.slice(n).flatMap((e) => t.wire(e.event.changes, v)));

/** Mira's to-hit 15 (d20 11), the DM's Apply hit on Goblin (hit), Goblin 2 (miss), Wolf (hit). */
function ruled() {
  const t = s5Setup();
  const { cardId } = t.toHit("Mira", 11);
  t.applyHit(cardId, 16, [
    t.target("Goblin", true),
    t.target("Goblin 2", false, "half"),
    t.target("Wolf", true),
  ]);
  return { t, cardId };
}

describe("FR-CBT-90 late roll (server)", () => {
  test("FR-CBT-90 late roll fills empty fields only: the late roll attaches to the ruled card; ruling and hit lines unchanged", () => {
    const { t, cardId } = ruled();
    const rulings = t.rulings();
    const lines = t.entries().length;
    const r = t.damage("Mira", 4);
    expect(r).toMatchObject({ cardId, attached: true });
    expect(r.unused).toBeUndefined();
    expect(t.card(cardId).p.damage?.total).toBe(6);
    expect(t.card(cardId).state).toBe("pending");
    expect(t.rulings()).toEqual(rulings);
    // Only the roll line is new.
    expect(t.entries()).toHaveLength(lines + 1);
  });
});

describe("FR-CBT-91 apply after Apply hit", () => {
  test("FR-CBT-91 apply after Apply hit: damage-only lines, hp_change to-hit facts from the ruling, ruled miss raw 0, dropped hit", () => {
    const { t, cardId } = ruled();
    t.damage("Mira", 4);
    const goblinHp = t.combatant("Goblin").hpCurrent as number;
    const { hpChangeIds } = applyDamage(t, cardId, [t.target("Goblin", true)]);
    // Ruling order: Goblin's damage, then Goblin 2's `raw 0` row; the dropped Wolf has none.
    const rows = hpRows(t, hpChangeIds);
    expect(
      rows.map((r) => [
        r.targetName,
        r.hit,
        r.raw,
        r.toHitTotal,
        r.toHitRolled,
        r.natural,
        r.hitComputed,
        r.multiplier,
      ]),
    ).toEqual([
      ["Goblin", true, 6, 16, 15, 11, true, "normal"],
      ["Goblin 2", false, 0, 16, 15, 11, true, "half"],
    ]);
    expect(t.combatant("Goblin").hpCurrent).toBe(goblinHp - 6);
    const [hit, miss] = rows.map((r) => entryOf(t, r.entryId)) as [
      GameLogEntryRecord,
      GameLogEntryRecord,
    ];
    expect(AttackLogPayload.parse(hit.payload).toHit).toBeNull();
    expect(t.line(hit, false)).toBe("Mira → Goblin: 6 piercing damage (Shortsword) (physical)");
    expect(hit.public).toBe(true);
    // The ruled miss's line is the DM's record of its row; players read the Apply hit line.
    expect(t.line(miss, true)).toBe("Mira → Goblin 2: miss (Shortsword)");
    expect(miss.public).toBe(false);
    const card = t.card(cardId);
    expect(card.state).toBe("resolved");
    expect(DamageCardTargetsResolution.parse(card.resolution).targets).toEqual([
      { targetName: "Goblin", hit: true, multiplier: "normal", applied: 6 },
      { targetName: "Goblin 2", hit: false, multiplier: "half", applied: 0 },
      // The Wolf is hidden: its name never reaches the card's owner.
      { targetName: null, hit: true, multiplier: "normal", applied: 0, dropped: true },
    ]);
  });

  test("FR-CBT-91 #138 the damage step's resolution carries the line's damage, never HP lost (40 → a killing blow reads 40)", () => {
    const { t, cardId } = ruled();
    t.damage("Mira", 4);
    const goblin = t.combatant("Goblin").hpCurrent as number;
    const wolf = t.combatant("Wolf").hpCurrent as number;
    const { hpChangeIds } = applyDamage(
      t,
      cardId,
      [t.target("Goblin", true), t.target("Wolf", true)],
      { damageTotal: 40 },
    );
    const rows = hpRows(t, hpChangeIds).filter((r) => r.hit);
    expect(rows.map((r) => [r.raw, r.applied, r.hpBefore])).toEqual([
      [40, goblin, goblin],
      [40, wolf, wolf],
    ]);
    const res = DamageCardTargetsResolution.parse(t.card(cardId).resolution);
    expect(resolutionText(res.targets)).toBe("Hit Goblin: 40 · Miss Goblin 2 · Hit: 40");
  });

  test("FR-CBT-91 a target outside the ruling, hit: false, or a toHitTotal → invalid; nothing written", () => {
    const { t, cardId } = ruled();
    t.damage("Mira", 4);
    const before = [t.count("hp_change"), t.count("game_log_entry"), t.events.length];
    const err = (targets: Target[], more: object = {}) =>
      t.err(() => applyDamage(t, cardId, targets, more));
    const outside = err([t.target("Elite Goblin Warrior", true)]);
    expect([outside.code, outside.message]).toEqual(["invalid", "Not a hit target"]);
    expect(err([t.target("Goblin 2", true)]).code).toBe("invalid");
    expect(err([t.target("Goblin", false)]).code).toBe("invalid");
    expect(err([t.target("Goblin", true)], { toHitTotal: 16 }).code).toBe("invalid");
    expect([t.count("hp_change"), t.count("game_log_entry"), t.events.length]).toEqual(before);
    expect(t.card(cardId).state).toBe("pending");
  });

  test("FR-CBT-91 Apply hit is never undone: undo → card pending, ruling re-upserted, damage kept; DM store = a fresh snapshot after each step", () => {
    const { t, cardId } = ruled();
    const store = t.dmStore();
    const fresh = () => t.snap(t.dmV, HIT_RULING_TYPE);
    t.damage("Mira", 4);
    expect(store()).toEqual(fresh());
    const rollId = t.card(cardId).p.damage?.rollId;
    applyDamage(t, cardId, [t.target("Goblin", true), t.target("Wolf", true)]);
    expect(store()).toEqual([]);
    expect(fresh()).toEqual([]);
    const lines = t.entries().length;
    t.undo();
    expect(t.card(cardId).state).toBe("pending");
    expect(t.card(cardId).p.damage?.rollId).toBe(rollId);
    expect(fresh()).toHaveLength(1);
    expect(store()).toEqual(fresh());
    // The Apply hit lines stay; only the damage lines are marked undone.
    const hitLines = t.entries().filter((e) => (e.payload as AttackLogPayload).awaitingDamage);
    expect(hitLines.map((e) => e.undone)).toEqual([false, false, false]);
    expect(t.entries()).toHaveLength(lines);
    // Re-applied from the damage step: the ruling is the to-hit again.
    applyDamage(t, cardId, [t.target("Goblin", true)]);
    expect(t.card(cardId).state).toBe("resolved");
    expect(store()).toEqual(fresh());
  });
});

describe("FR-CBT-92 rolling again", () => {
  test("FR-CBT-92 second late roll unused: no card, unusedRolls [7], unused: true, roll line public; the last 3 kept", () => {
    const t = s5Setup();
    const { cardId } = t.toHit("Mira", 11);
    t.damage("Mira", 4);
    const cards = damageCards(t).length;
    const text = t.card(cardId).text;
    const r = t.damage("Mira", 5);
    expect(r).toMatchObject({ cardId, attached: false, unused: true });
    expect(damageCards(t)).toHaveLength(cards);
    const c = t.card(cardId);
    expect(c.p.unusedRolls).toEqual([{ rollId: r.rollIds[0] as string, total: 7 }]);
    // The first value stays the card's damage; its text is unchanged.
    expect(c.p.damage?.total).toBe(6);
    expect(c.text).toBe(text);
    expect(t.entries().at(-1)?.public).toBe(true);
    for (const d of [1, 2, 3, 5]) t.damage("Mira", d);
    expect(t.card(cardId).p.unusedRolls?.map((u) => u.total)).toEqual([4, 5, 7]);
    expect(damageCards(t)).toHaveLength(cards);
  });

  test("FR-CBT-92 the DM's extra roll on Mira's card → a new DM damage-only card, unusedRolls unchanged, nothing new for player-1", () => {
    const t = s5Setup();
    const { cardId } = t.toHit("Mira", 11);
    t.damage("Mira", 4);
    t.damage("Mira", 5);
    const unused = t.card(cardId).p.unusedRolls;
    const n = t.events.length;
    const r = t.damage("Mira", 5, t.h.dm);
    expect(r.attached).toBe(false);
    expect(r.unused).toBeUndefined();
    expect(r.cardId).not.toBe(cardId);
    const dmCard = t.card(r.cardId);
    expect([dmCard.audience, dmCard.p.toHit]).toEqual(["dm", null]);
    expect(t.card(cardId).p.unusedRolls).toEqual(unused);
    // No DM-only roll reaches the owner: neither its line nor the DM's card.
    expect(framesSince(t, n, t.p1V)).toBe("[]");
  });

  test("FR-CBT-92 the DM's own card: the DM's second roll is unused; a damage-only row makes a new card per roll", () => {
    const t = s5Setup();
    const { cardId } = t.toHit("Goblin", 10, t.h.dm);
    t.damage("Goblin", 3, t.h.dm);
    const r = t.damage("Goblin", 4, t.h.dm);
    expect(r).toMatchObject({ cardId, attached: false, unused: true });
    expect(t.entries().at(-1)?.public).toBe(false);
    // Damage-only (no to-hit card): every roll its own card.
    const a = t.damage("Thorn", 2, t.player(t.h.p2));
    const b = t.damage("Thorn", 3, t.player(t.h.p2));
    expect(a.cardId).not.toBe(b.cardId);
    expect([a.unused, b.unused]).toEqual([undefined, undefined]);
  });

  test("FR-CBT-92 leak: unusedRolls only in the owner's frames (live and snapshot)", () => {
    const t = s5Setup();
    const n = t.events.length;
    t.toHit("Mira", 11);
    t.damage("Mira", 4);
    t.damage("Mira", 5);
    expect(framesSince(t, n, t.p1V)).toContain("unusedRolls");
    expect(framesSince(t, n, t.p2V)).not.toContain("unusedRolls");
    expect(JSON.stringify(t.h.snapshot(t.p1V))).toContain("unusedRolls");
    expect(JSON.stringify(t.h.snapshot(t.p2V))).not.toContain("unusedRolls");
  });
});

describe("FR-CBT-93 when a late roll can't join", () => {
  test("FR-CBT-93 no join when closed or applied: pending → attaches; resolved → new damage-only card; Thorn's roll never changes Mira's card", () => {
    const t = s5Setup();
    const { cardId } = t.toHit("Mira", 11);
    t.applyHit(cardId, 15, [t.target("Goblin", true)]);
    // (c) another attacker: its own card.
    const thorn = t.damage("Thorn", 3, t.player(t.h.p2));
    expect(thorn.cardId).not.toBe(cardId);
    expect(t.card(cardId).p.damage).toBeNull();
    // (a) no popup involved: the card is pending, so the roll attaches.
    expect(t.damage("Mira", 4)).toMatchObject({ cardId, attached: true });
    applyDamage(t, cardId, [t.target("Goblin", true)]);
    // (b) resolved: a new damage-only card (as built).
    const late = t.damage("Mira", 5);
    expect(late.attached).toBe(false);
    expect(late.cardId).not.toBe(cardId);
    expect(t.card(late.cardId).p.toHit).toBeNull();
    expect(t.card(late.cardId).p.attackName).toBe(t.card(cardId).p.attackName);
  });
});

describe("FR-CBT-94 ordering", () => {
  test("FR-CBT-94 ordering: Apply hit → roll valid; stale damageRollId → conflict; Apply first → the roll makes a new card; two rolls → one attached, one unused", () => {
    const t = s5Setup();
    const { cardId } = t.toHit("Mira", 11);
    t.applyHit(cardId, 15, [t.target("Goblin", true)]);
    // The popup was built before the roll: null, while the roll committed.
    const first = t.damage("Mira", 4);
    const second = t.damage("Mira", 6);
    expect([first.attached, second.unused]).toEqual([true, true]);
    const w = [t.count("hp_change"), t.count("game_log_entry")];
    const stale = t.err(() =>
      t.run(applyCard.name, {
        cardId,
        damageTotal: 6,
        damageRollId: null,
        partRollIds: partRollIdsOf(t.card(cardId).p),
        targets: [t.target("Goblin", true)],
      }),
    );
    expect([stale.code, stale.message]).toEqual(["conflict", DAMAGE_JUST_ARRIVED]);
    expect([t.count("hp_change"), t.count("game_log_entry")]).toEqual(w);
    applyDamage(t, cardId, [t.target("Goblin", true)]);
    expect(t.card(cardId).state).toBe("resolved");
    expect(t.damage("Mira", 2)).toMatchObject({ attached: false });
  });

  test("FR-CBT-94 crash: a late roll on a ruled card commits roll + card together or not at all", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = s5Setup();
    const { cardId } = t.toHit("Mira", 11);
    t.applyHit(cardId, 15, [t.target("Goblin", true)]);
    const lines = t.count("game_log_entry");
    try {
      armCrashHook({ point: "before-commit", target: "cbt.rollDamage" }, kill);
      expect(() => t.damage("Mira", 4)).toThrow();
      expect(t.card(cardId).p.damage).toBeNull();
      expect(t.count("game_log_entry")).toBe(lines);
      armCrashHook({ point: "after-commit", target: "cbt.rollDamage" }, kill);
      expect(() => t.damage("Mira", 4)).toThrow(Killed);
      expect(t.card(cardId).p.damage?.total).toBe(6);
      expect(t.count("game_log_entry")).toBe(lines + 1);
      expect(t.rulings()).toHaveLength(1);
    } finally {
      armCrashHook(null);
    }
  });
});

describe("FR-MOD-63 offers on a late roll", () => {
  test("FR-MOD-63 offers on a late roll: Brakka Attack → Apply hit → Damage: Divine Fury offered with the damage, spent at the final Apply only", () => {
    const t = rtSetup();
    t.nextTo("Brakka", 1);
    t.rage(true);
    const { cardId } = t.attack("Brakka", { rolls: "toHit", toHit: 15 });
    t.run(applyHitCommand.name, {
      cardId,
      toHitTotal: 22,
      partRollIds: partRollIdsOf(t.card(cardId)),
      targets: [{ targetId: t.id("Goblin"), hit: true, multiplier: "normal" }],
    });
    // Apply hit spends nothing and writes no `used` row.
    expect(t.uses()).toEqual([]);
    t.rollDamage("Brakka", 8);
    const offer = t.card(cardId).damage?.triggers?.[0];
    expect(offer).toMatchObject({ triggerId: t.furyId, label: "Divine Fury" });
    expect(t.uses().map((u) => u.state)).toEqual(["offered"]);
    const p = t.card(cardId);
    t.run(applyCard.name, {
      cardId,
      damageTotal: p.damage?.total,
      damageRollId: p.damage?.rollId,
      partRollIds: partRollIdsOf(p),
      targets: [
        {
          targetId: t.id("Goblin"),
          hit: true,
          multiplier: "normal",
          triggers: [{ triggerId: t.furyId, multiplier: "normal" }],
        },
      ],
    });
    expect(t.uses().map((u) => u.state)).toEqual(["used"]);
  });
});
