// GEM GM2 integration (in-process): the Combat gem (FR-GEM-25–31) on combat-tracker's
// `cards.maxDice` (FR-CBT-128, -129, -131, -133, -134): Brakka's Flame Tongue greatsword +1
// (`2d6+4` slashing, bonus 1, Rage + 2, extra `2d6` fire, Divine Fury offered on his turn), levels,
// physical totals, the line by audience, late damage / Apply hit, undo, the crit flip GM1 deferred,
// races, leak scan, gems off, crash.
import { afterEach, describe, expect, test } from "bun:test";
import { GEMS_FEATURE } from "@shared/campaign-management/features";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import type { AttackLogDmPayload } from "@shared/combat-tracker/log-kinds";
import {
  type AttackResult,
  type DamageCardPayload,
  type HpChangesResult,
  partRollIdsOf,
  type RollDamageResult,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { DieResult, GameLogEntryRecord, ManualEntry } from "@shared/dice-roll-log/schemas";
import { GemSpent } from "@shared/events/gems";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { entity, gameLogEntry, hpChange, roll } from "../../db/schema";
import type { Actor } from "../../events/types";
import { setFeature } from "../campaign-management/features";
import { attackCommand } from "../combat-tracker/attack";
import {
  ALREADY_APPLIED,
  ALREADY_MAXED,
  ENTER_EACH_DIE,
  NO_DAMAGE_YET,
} from "../combat-tracker/cards";
import { rollDamageCommand } from "../combat-tracker/damage";
import { applyHitCommand } from "../combat-tracker/hit";
import { applyCard, CARD_CHANGED, undoCommand } from "../combat-tracker/hp";
import { rtSetup } from "../effect-modifiers/trigger-testing";
import { levelNeeded } from "./combat";
import { adjustGems, GEMS_OFF, spendGem } from "./commands";

afterEach(() => armCrashHook(null));

type Pick = { part: "base" | number; index: number };

function setup(o: { rage?: boolean } = {}) {
  const t = rtSetup();
  t.run(setFeature.name, { feature: GEMS_FEATURE, on: true });
  const award = (characterId: string, gem: string, delta: number) =>
    t.run(adjustGems.name, { characterId, gem, delta });
  award(t.brakkaId, "combat", 4);
  award(t.brakkaId, "inspiration", 1);
  award(t.miraId, "combat", 1);
  award(t.thornId, "combat", 1);
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
  t.nextTo("Brakka", 1);
  if (o.rage !== false) t.rage(true);
  const flame = (
    manual: ManualEntry[],
    manualExtra?: ManualEntry[],
    extra: Record<string, unknown> = {},
    actor: Actor = t.p1,
  ) =>
    t.seeded<AttackResult>(
      attackCommand.name,
      {
        attackerId: t.id("Brakka"),
        attackId,
        manual,
        ...(manualExtra ? { manualExtra } : {}),
        ...extra,
      },
      actor,
    );
  /** d20 14; slashing 3, 5 (+ 5: bonus 1, Rage 2 → 15); fire 2, 6. */
  const step3 = (actor: Actor = t.p1) =>
    flame(
      [{ diceTotal: 14 }, { diceTotal: 8, dice: [3, 5] }],
      [{ diceTotal: 8, dice: [2, 6] }],
      {},
      actor,
    );
  let keys = 0;
  const spend = (
    cardId: string,
    dice: Pick[],
    x: { known?: object[]; characterId?: string; actor?: Actor } = {},
  ) =>
    t.run<{ held: number; entryId: string }>(
      spendGem.name,
      {
        characterId: x.characterId ?? t.brakkaId,
        gem: "combat",
        cardId,
        dice,
        ...(x.known ? { known: x.known } : {}),
      },
      x.actor ?? t.p1,
      `gm2-${++keys}`,
    );
  const note = (cardId: string) => t.note(cardId) as NotificationRecord;
  const rollRow = (id: string) => t.s.db.select().from(roll).where(eq(roll.id, id)).get();
  const entry = (id: string) =>
    t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, id)).get() as GameLogEntryRecord;
  const text = (e: GameLogEntryRecord, dm = true) =>
    lineText(
      formatEntry({
        kind: e.kind,
        actorName: e.actorName,
        payload: e.payload,
        ...(dm ? { dmPayload: e.dmPayload } : {}),
        category: e.category,
      }).segments,
    );
  const combat = (id = t.brakkaId) =>
    (
      t.s.db.$client
        .query<{ n: number }, [string]>("SELECT combat AS n FROM character_gems WHERE id = ?")
        .get(id) ?? { n: 0 }
    ).n;
  const setLevel = (id: string, level: number) => {
    const row = t.s.db.select().from(entity).where(eq(entity.id, id)).get();
    const statBlock = { ...(row?.statBlock as object), level };
    t.s.db.update(entity).set({ statBlock }).where(eq(entity.id, id)).run();
  };
  const apply = (cardId: string, more: Record<string, unknown> = {}) => {
    const p = t.card(cardId);
    return t.run<HpChangesResult>(applyCard.name, {
      cardId,
      ...(p.toHit && !p.ruled ? { toHitTotal: p.toHit.total } : {}),
      damageTotal: p.damage?.total ?? 0,
      damageRollId: p.damage?.rollId ?? null,
      partRollIds: partRollIdsOf(p),
      ...(p.damage?.extra ? { extraTotals: p.damage.extra.map((x) => x.total) } : {}),
      targets: [{ targetId: t.id("Goblin"), hit: true, multiplier: "normal" }],
      ...more,
    });
  };
  const goblinHp = () => t.byName(t.enc.id).Goblin?.hpCurrent as number;
  const dmV = t.h.viewer("dm");
  const p1V = t.h.viewer("player", t.h.p1.id);
  const p2V = t.h.viewer("player", t.h.p2.id);
  const wire = (from: number, v: typeof dmV) =>
    t.events
      .slice(from)
      .flatMap((e) => e.event.changes)
      .map((c) => t.s.records.filterChange(c, v))
      .filter((w) => w !== null);
  return {
    ...t,
    attackId,
    flame,
    step3,
    spend,
    note,
    rollRow,
    entry,
    text,
    combat,
    setLevel,
    apply,
    goblinHp,
    dmV,
    p1V,
    p2V,
    wire,
  };
}

const full = (p: DamageCardPayload) =>
  (p.damage?.total ?? 0) + (p.damage?.extra ?? []).reduce((s, x) => s + x.total, 0);

describe("FR-GEM-25 / FR-CBT-128 Combat gem: max dice", () => {
  test("FR-CBT-128 max dice / FR-GEM-25 combat on pending card / FR-GEM-29 / FR-GEM-30 line wording: base d6 3 → 6, new roll row, total + 3 incl. mods, maxed, diceMaxed", () => {
    const t = setup();
    const { cardId } = t.step3();
    const before = t.note(cardId);
    const old = t.card(cardId);
    expect([old.damage?.total, old.damage?.extra?.[0]?.total]).toEqual([15, 8]);
    const n = t.events.length;
    const r = t.spend(cardId, [{ part: "base", index: 0 }]);
    expect(r.held).toBe(3);
    const p = t.card(cardId);
    const row = t.rollRow(p.damage?.rollId as string);
    expect(row?.replacesRollId).toBe(old.damage?.rollId as string);
    expect(row?.manual).toBe(true);
    expect(((row?.dice ?? []) as DieResult[]).map((d) => d.value)).toEqual([6, 5]);
    expect(row?.total).toBe(6 + 5 + 4 + 1);
    // The old row stays as rolled (append-only).
    expect(t.rollRow(old.damage?.rollId as string)?.total).toBe(3 + 5 + 4 + 1);
    expect(p.damage).toMatchObject({
      total: 18,
      maxed: [0],
      dice: [
        [6, true],
        [5, true],
      ],
      mods: old.damage?.mods,
      triggers: old.damage?.triggers,
    });
    expect(p.damage?.extra).toEqual(old.damage?.extra);
    expect(p.diceMaxed).toBe(true);
    const after = t.note(cardId);
    expect([after.seq, after.state]).toEqual([before.seq, "pending"]);
    expect(after.text.startsWith("Brakka: 22 to hit, 18 slashing + 8 fire")).toBe(true);
    // Order: the owner's event, then the card (protocol §22); the event names the new row.
    const events = t.events.slice(n).map((x) => x.event);
    expect(events.map((e) => e.type)).toEqual([GemSpent.type, "NotificationUpdated"]);
    expect(events[0]?.payload).toMatchObject({ cardId, cost: 1, held: 3, rollIds: [row?.id] });
    expect(t.text(t.entry(r.entryId))).toBe(
      "Brakka spends a Combat gem — Flame Tongue greatsword: slashing d6 3 → 6 (rolled 23 → 26)",
    );
    expect(t.entry(r.entryId).public).toBe(true);
  });

  test("FR-CBT-128 … extra part: the Flame Tongue fire die maxed, base unchanged; two dice over two parts at level 6", () => {
    const t = setup();
    const { cardId } = t.step3();
    const old = t.card(cardId);
    t.spend(cardId, [{ part: 0, index: 0 }]);
    const p = t.card(cardId);
    expect(p.damage?.rollId).toBe(old.damage?.rollId as string);
    expect(p.damage?.total).toBe(15);
    expect(p.damage?.maxed).toBeUndefined();
    expect(p.damage?.extra?.[0]).toMatchObject({ total: 12, maxed: [0] });
    expect(t.rollRow(p.damage?.extra?.[0]?.rollId as string)?.replacesRollId).toBe(
      old.damage?.extra?.[0]?.rollId as string,
    );
    // Level 6: two dice, one per part.
    t.setLevel(t.brakkaId, 6);
    const b = t.step3();
    const r = t.spend(b.cardId, [
      { part: 0, index: 0 },
      { part: "base", index: 1 },
    ]);
    const q = t.card(b.cardId);
    expect([q.damage?.total, q.damage?.maxed, q.damage?.extra?.[0]?.total]).toEqual([16, [1], 12]);
    expect(t.text(t.entry(r.entryId))).toBe(
      "Brakka spends a Combat gem — Flame Tongue greatsword: fire d6 2 → 6, slashing d6 5 → 6 (rolled 23 → 28)",
    );
  });

  test("FR-GEM-26 levels: 1 die at 1–5, 2 at 6–11, 3 at 12+; more → invalid, nothing written", () => {
    const t = setup();
    const { cardId } = t.step3();
    const two = [
      { part: "base" as const, index: 0 },
      { part: "base" as const, index: 1 },
    ];
    const e = t.err(() => t.spend(cardId, two));
    expect([e.code, e.message]).toEqual(["invalid", levelNeeded(2)]);
    expect(levelNeeded(2)).toBe("Level 6 needed for 2 dice");
    t.setLevel(t.brakkaId, 11);
    const three = [...two, { part: 0, index: 0 }];
    const f = t.err(() => t.spend(cardId, three));
    expect([f.code, f.message]).toEqual(["invalid", "Level 12 needed for 3 dice"]);
    expect([t.combat(), t.card(cardId).diceMaxed]).toEqual([4, undefined]);
    t.setLevel(t.brakkaId, 12);
    t.spend(cardId, three);
    expect(full(t.card(cardId))).toBe(23 + 3 + 1 + 4);
  });

  test("FR-GEM-27 dice: only kept weapon dice of a part below their max; never mods / triggers; each once", () => {
    const t = setup();
    const { cardId } = t.step3();
    const p = t.card(cardId);
    // Divine Fury is offered (a trigger part) and Rage is a mod: neither is a part to pick.
    expect(p.damage?.triggers?.length).toBe(1);
    expect(p.damage?.mods?.length).toBe(1);
    const bad = (dice: Pick[]) => {
      const e = t.err(() => t.spend(cardId, dice));
      return [e.code, e.message];
    };
    expect(bad([{ part: 1, index: 0 }])).toEqual(["invalid", "No such damage part"]);
    expect(bad([{ part: "base", index: 2 }])).toEqual(["invalid", "No such die"]);
    expect(bad([{ part: 0, index: 1 }])).toEqual(["invalid", "Already at its max"]);
    t.setLevel(t.brakkaId, 6);
    expect(
      bad([
        { part: "base", index: 0 },
        { part: "base", index: 0 },
      ]),
    ).toEqual(["invalid", "Each die once"]);
    expect(t.err(() => t.spend(cardId, [])).code).toBe("invalid");
    expect([t.combat(), t.card(cardId)]).toEqual([4, p]);
  });

  test("FR-CBT-128 … known dice / FR-GEM-28 physical: a total-only part needs each die (count, faces, sum)", () => {
    const t = setup();
    const { cardId } = t.flame([{ diceTotal: 14 }, { diceTotal: 8 }], [{ diceTotal: 9 }]);
    const p = t.card(cardId);
    expect(p.damage?.dice).toEqual([
      [null, true],
      [null, true],
    ]);
    const pick = [{ part: "base" as const, index: 0 }];
    const bad = (known?: object[]) => {
      const e = t.err(() => t.spend(cardId, pick, known ? { known } : {}));
      return [e.code, e.message];
    };
    expect(bad()).toEqual(["invalid", ENTER_EACH_DIE]);
    expect(bad([{ part: "base", dice: [3] }])).toEqual(["invalid", "Enter 2 dice"]);
    expect(bad([{ part: "base", dice: [3, 4] }])).toEqual([
      "invalid",
      "The dice add up to 7, not 8",
    ]);
    expect(bad([{ part: "base", dice: [7, 1] }])).toEqual(["invalid", "A die is above its faces"]);
    expect(bad([{ part: "base", dice: [6, 2] }])).toEqual(["invalid", "Already at its max"]);
    expect(t.combat()).toBe(4);
    t.spend(cardId, pick, { known: [{ part: "base", dice: [3, 5] }] });
    const q = t.card(cardId);
    expect(q.damage?.dice).toEqual([
      [6, true],
      [5, true],
    ]);
    expect(q.damage?.total).toBe(p.damage ? p.damage.total + 3 : 0);
    expect(t.rollRow(q.damage?.rollId as string)?.manual).toBe(true);
    // A part with known dice takes no `known`.
    const b = t.step3();
    const e = t.err(() => t.spend(b.cardId, pick, { known: [{ part: "base", dice: [3, 5] }] }));
    expect([e.code, e.message]).toEqual(["invalid", "This part's dice are known"]);
  });
});

describe("FR-GEM-25 eligibility and races", () => {
  test("FR-GEM-25 eligible: pending with damage, own attacker, not maxed yet; FR-GEM-37 races: a second Combat gem → conflict", () => {
    const t = setup();
    // A to-hit-only card has no damage yet.
    const a = t.flame([{ diceTotal: 14 }], undefined, { rolls: "toHit" });
    const e = t.err(() => t.spend(a.cardId, [{ part: "base", index: 0 }]));
    expect([e.code, e.message]).toEqual(["conflict", NO_DAMAGE_YET]);
    const { cardId } = t.step3();
    // Mira (the same player's other character) can't spend on Brakka's attack.
    const m = t.err(() => t.spend(cardId, [{ part: "base", index: 0 }], { characterId: t.miraId }));
    expect([m.code, m.message]).toEqual(["conflict", "Not Mira's attack"]);
    // Player 2: not their character (forbidden); their own Thorn on a card they don't get.
    const f = t.err(() => t.spend(cardId, [{ part: "base", index: 0 }], { actor: t.p2 }));
    expect(f.code).toBe("forbidden");
    const nf = t.err(() =>
      t.spend(cardId, [{ part: "base", index: 0 }], { characterId: t.thornId, actor: t.p2 }),
    );
    expect(nf.code).toBe("not_found");
    t.spend(cardId, [{ part: "base", index: 0 }]);
    const again = t.err(() => t.spend(cardId, [{ part: 0, index: 0 }]));
    expect([again.code, again.message]).toEqual(["conflict", ALREADY_MAXED]);
    expect(t.combat()).toBe(3);
    // OQ-GEM-14 A: the DM spends for the player.
    const b = t.step3();
    t.spend(b.cardId, [{ part: 0, index: 0 }], { actor: t.h.dm });
    expect(t.card(b.cardId).diceMaxed).toBe(true);
    // Too few gems → conflict, nothing written.
    t.run(adjustGems.name, { characterId: t.brakkaId, gem: "combat", delta: -2 });
    const c = t.step3();
    const none = t.err(() => t.spend(c.cardId, [{ part: "base", index: 0 }]));
    expect([none.code, none.message]).toEqual(["conflict", "No Combat gem left"]);
    expect(t.card(c.cardId).diceMaxed).toBeUndefined();
  });

  test("FR-GEM-03 off refuses a Combat gem; FR-GEM-05 off hides gem traces: the DM line's `max` marks stripped, on restores", () => {
    const t = setup();
    const { cardId } = t.step3();
    t.spend(cardId, [{ part: "base", index: 0 }]);
    const [hpId] = t.apply(cardId).hpChangeIds;
    const line = () => {
      const entryId = t.s.db
        .select()
        .from(hpChange)
        .where(eq(hpChange.id, hpId as string))
        .get()?.entryId as string;
      const snap = (t.h.snapshot(t.dmV)["game-log-entry"] ?? []) as GameLogEntryRecord[];
      return snap.find((e) => e.id === entryId) as GameLogEntryRecord;
    };
    expect(t.text(line())).toContain("(2d6+5: 6 + 5 + 5");
    expect(JSON.stringify(line().dmPayload)).toContain('"maxed":[0]');
    t.run(setFeature.name, { feature: GEMS_FEATURE, on: false });
    expect(JSON.stringify(line().dmPayload)).not.toContain("maxed");
    expect(t.text(line())).toContain("(2d6+5: 6 + 5 + 5");
    const b = t.step3();
    const e = t.err(() => t.spend(b.cardId, [{ part: "base", index: 0 }]));
    expect([e.code, e.message]).toEqual(["forbidden", GEMS_OFF]);
    t.run(setFeature.name, { feature: GEMS_FEATURE, on: true });
    expect(JSON.stringify(line().dmPayload)).toContain('"maxed":[0]');
  });
});

describe("FR-GEM-31 / FR-CBT-129–134 the maxed card at apply", () => {
  test("FR-GEM-31 apply uses maxed totals / FR-CBT-131 maxed markers on the DM line (players' text unchanged); hp_change lists the new rows", () => {
    const t = setup({ rage: false });
    const { cardId } = t.step3();
    t.spend(cardId, [{ part: 0, index: 0 }]);
    const p = t.card(cardId);
    const hp = t.goblinHp();
    const [hpId] = t.apply(cardId).hpChangeIds;
    const row = t.s.db
      .select()
      .from(hpChange)
      .where(eq(hpChange.id, hpId as string))
      .get();
    expect(row?.raw).toBe(full(p));
    expect(t.goblinHp()).toBe(Math.max(0, hp - full(p)));
    expect(row?.rollIds).toContain(p.damage?.extra?.[0]?.rollId as string);
    const e = t.entry(row?.entryId as string);
    const dm = e.dmPayload as AttackLogDmPayload;
    expect(dm.rolls?.extra?.[0]?.maxed).toEqual([0]);
    expect(dm.rolls?.damage?.maxed).toBeUndefined();
    // The DM's fire chip reads `max`; the public text carries no "max".
    const chips = formatEntry({ ...e, dmPayload: e.dmPayload }).segments.filter((s) => s.die);
    expect(chips.filter((s) => s.die?.label === "max").map((s) => s.text)).toEqual(["6"]);
    expect(t.text(e, false)).not.toContain("max");
  });

  test("FR-CBT-129 stale apply: the popup's old base / extra roll ids after a max → conflict, nothing written", () => {
    const t = setup();
    const { cardId } = t.step3();
    const old = t.card(cardId);
    t.spend(cardId, [{ part: "base", index: 0 }]);
    const rows = t.count("hp_change");
    const stale = (more: Record<string, unknown>) => t.err(() => t.apply(cardId, more));
    const a = stale({ damageRollId: old.damage?.rollId });
    expect([a.code, a.message]).toEqual(["conflict", CARD_CHANGED]);
    const b = t.step3();
    const oldB = t.card(b.cardId);
    t.spend(b.cardId, [{ part: 0, index: 0 }]);
    const x = t.err(() => t.apply(b.cardId, { partRollIds: partRollIdsOf(oldB) }));
    expect([x.code, x.message]).toEqual(["conflict", CARD_CHANGED]);
    expect(t.count("hp_change")).toBe(rows);
  });

  test("FR-CBT-133 undo keeps maxed / FR-GEM-31 undo keeps maxed: apply → undo → reopened with maxed; a second max → conflict; dismiss: no refund", () => {
    const t = setup();
    const { cardId } = t.step3();
    t.spend(cardId, [{ part: "base", index: 0 }]);
    const p = t.card(cardId);
    const [hpId] = t.apply(cardId).hpChangeIds;
    t.run(undoCommand.name, { expectedHpChangeId: hpId });
    expect(t.note(cardId).state).toBe("pending");
    expect(t.card(cardId)).toEqual(p);
    const e = t.err(() => t.spend(cardId, [{ part: 0, index: 0 }]));
    expect([e.code, e.message]).toEqual(["conflict", ALREADY_MAXED]);
    // Re-apply uses the maxed totals again.
    const [again] = t.apply(cardId).hpChangeIds;
    expect(
      t.s.db
        .select()
        .from(hpChange)
        .where(eq(hpChange.id, again as string))
        .get()?.raw,
    ).toBe(full(p));
    // Applied / dismissed → "Already applied"; the gem spent stays spent.
    const held = t.combat();
    const done = t.err(() => t.spend(cardId, [{ part: 0, index: 0 }]));
    expect([done.code, done.message]).toEqual(["conflict", ALREADY_APPLIED]);
    const b = t.step3();
    t.spend(b.cardId, [{ part: 0, index: 0 }]);
    t.run("note.dismiss", { id: b.cardId });
    expect(t.combat()).toBe(held - 1);
    expect(t.note(b.cardId).state).toBe("dismissed");
  });

  test("FR-CBT-134 damage step max / FR-GEM-25 late damage / FR-GEM-29 apply hit order: Apply hit → late damage → max → Apply; max → Apply hit also valid", () => {
    const t = setup({ rage: false });
    const a = t.flame([{ diceTotal: 14 }], undefined, { rolls: "toHit" });
    const hit = (cardId: string) =>
      t.run(applyHitCommand.name, {
        cardId,
        toHitTotal: t.card(cardId).toHit?.total,
        targets: [{ targetId: t.id("Goblin"), hit: true, multiplier: "normal" }],
        partRollIds: partRollIdsOf(t.card(cardId)),
      });
    hit(a.cardId);
    expect(t.card(a.cardId).ruled).toBe(true);
    const dmg = t.seeded<RollDamageResult>(
      rollDamageCommand.name,
      {
        attackerId: t.id("Brakka"),
        attackId: t.attackId,
        manual: { diceTotal: 4, dice: [1, 3] },
        manualExtra: [{ diceTotal: 5, dice: [4, 1] }],
      },
      t.p1,
    );
    expect(dmg.attached).toBe(true);
    t.spend(a.cardId, [{ part: "base", index: 0 }]);
    const p = t.card(a.cardId);
    expect([p.damage?.total, p.ruled, p.diceMaxed]).toEqual([6 + 3 + 5, true, true]);
    const hp = t.goblinHp();
    t.apply(a.cardId);
    expect(t.goblinHp()).toBe(Math.max(0, hp - full(p)));
    // The other order: max first, then Apply hit (doesn't touch damage), then Apply.
    const b = t.step3();
    t.spend(b.cardId, [{ part: 0, index: 0 }]);
    const q = t.card(b.cardId);
    hit(b.cardId);
    expect(t.card(b.cardId).damage).toEqual(q.damage);
    const hp2 = t.goblinHp();
    t.apply(b.cardId);
    expect(t.goblinHp()).toBe(Math.max(0, hp2 - full(q)));
  });

  test("FR-GEM-31 crit flip clears diceMaxed / FR-CBT-127 crit flip (a maxed card): an Inspiration crit flip moves the maxed damage to not used; a new Combat gem maxes the new damage", () => {
    const t = setup({ rage: false });
    const { cardId } = t.flame(
      [{ diceTotal: 9 }, { diceTotal: 8, dice: [3, 5] }],
      [{ diceTotal: 8, dice: [2, 6] }],
    );
    t.spend(cardId, [{ part: "base", index: 0 }]);
    const maxed = t.card(cardId);
    const toHitEntry = (t.s.db.select().from(gameLogEntry).all() as GameLogEntryRecord[]).find(
      (e) => e.kind === "roll" && e.rollIds.includes(maxed.toHit?.rollId as string),
    ) as GameLogEntryRecord;
    t.run(
      spendGem.name,
      {
        characterId: t.brakkaId,
        gem: "inspiration",
        entryId: toHitEntry.id,
        manual: { diceTotal: 20 },
      },
      t.p1,
    );
    const p = t.card(cardId);
    expect([p.crit, p.damage, p.diceMaxed]).toEqual([true, null, undefined]);
    expect(p.unusedRolls).toEqual([
      { rollId: maxed.damage?.rollId as string, total: 6 + 5 + 5 + 8 },
    ]);
    // The first gem stays spent; the new (doubled) damage takes a new one.
    expect(t.combat()).toBe(3);
    t.seeded<RollDamageResult>(
      rollDamageCommand.name,
      {
        attackerId: t.id("Brakka"),
        attackId: t.attackId,
        manual: { diceTotal: 8, dice: [1, 2, 3, 2] },
        manualExtra: [{ diceTotal: 8, dice: [2, 2, 2, 2] }],
      },
      t.p1,
    );
    t.spend(cardId, [{ part: 0, index: 3 }]);
    const q = t.card(cardId);
    expect([q.diceMaxed, q.damage?.extra?.[0]?.maxed, q.damage?.extra?.[0]?.total]).toEqual([
      true,
      [3],
      12,
    ]);
    expect(t.combat()).toBe(2);
  });
});

describe("FR-GEM-13 detail by audience; leak scan", () => {
  test("FR-GEM-13 detail by audience: a DM-made card's spend line shows no detail to players; the DM's line has it", () => {
    const t = setup();
    const { cardId } = t.step3(t.h.dm);
    expect(t.note(cardId).audience).toBe("dm");
    const r = t.spend(cardId, [{ part: "base", index: 0 }], { actor: t.h.dm });
    const e = t.entry(r.entryId);
    expect(e.public).toBe(true);
    expect(t.text(e, false)).toBe("Brakka spends a Combat gem");
    expect(t.text(e)).toBe(
      "Brakka spends a Combat gem — Flame Tongue greatsword: slashing d6 3 → 6 (rolled 23 → 26)",
    );
    for (const v of [t.p1V, t.p2V]) {
      const snap = JSON.stringify(t.h.snapshot(v));
      expect(snap).not.toContain(cardId);
      expect(snap).not.toContain(`"from":23`);
      expect(snap).not.toContain('"faces"');
    }
    // A player can't spend on a card they don't get.
    const nf = t.err(() => t.spend(cardId, [{ part: 0, index: 0 }]));
    expect(nf.code).toBe("not_found");
  });

  test("FR-GEM-25 leak scan: player-2 never gets player-1's card or its maxed dice (frames, snapshot); P1 and the DM do", () => {
    const t = setup();
    const n = t.events.length;
    const { cardId } = t.step3();
    t.spend(cardId, [{ part: "base", index: 0 }]);
    const cards = (v: typeof t.dmV) => t.wire(n, v).filter((w) => w.type === "notification");
    expect(cards(t.p2V)).toEqual([]);
    expect(cards(t.p1V).map((w) => w.id)).toEqual([cardId, cardId]);
    expect(cards(t.dmV).map((w) => w.id)).toEqual([cardId, cardId]);
    const snap = t.h.snapshot(t.p2V);
    expect((snap.notification ?? []) as unknown[]).toEqual([]);
    const p2 = JSON.stringify(snap);
    expect(p2).not.toContain('"diceMaxed"');
    expect(p2).not.toContain('"maxed"');
    expect(JSON.stringify(t.h.snapshot(t.p1V))).toContain('"diceMaxed":true');
    // The spend line is public (the card's rolls are the owner's public rolls).
    expect(JSON.stringify(t.wire(n, t.p2V))).toContain(`"from":23,"to":26`);
  });

  test("FR-GEM-12 crash: Combat gem before-commit → digest equal; after-commit → all of it", () => {
    const t = setup();
    const { cardId } = t.step3();
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const before = stateDigest(t.s.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: spendGem.name }, kill);
    expect(() => t.spend(cardId, [{ part: "base", index: 0 }])).toThrow();
    armCrashHook(null);
    expect(stateDigest(t.s.db.$client).sha256).toBe(before);
    expect(t.card(cardId).diceMaxed).toBeUndefined();
    armCrashHook({ point: "after-commit", target: spendGem.name }, kill);
    expect(() => t.spend(cardId, [{ part: "base", index: 0 }])).toThrow(Killed);
    armCrashHook(null);
    expect(t.card(cardId).diceMaxed).toBe(true);
    expect(t.combat()).toBe(3);
  });
});
