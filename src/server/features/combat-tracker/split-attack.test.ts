// N7 split attack (ADR-0037, FR-CBT-70–73): `cbt.attack {rolls: "toHit"}` makes a to-hit-only
// card, `cbt.rollDamage` completes the attacker's latest pending one of the same row (or makes a
// damage-only card), `cbt.applyCard` applies partial cards; outcome lines per FR-CBT-73.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import { attackLogKind } from "@shared/combat-tracker/log-kinds";
import {
  type AttackResult,
  DamageCardPayload,
  type HpChangeRecord,
  type HpChangesResult,
  type RollDamageResult,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { asc, eq } from "drizzle-orm";
import { gameLogEntry, hpChange, notification, roll } from "../../db/schema";
import type { Actor } from "../../events/types";
import { cbtxSetup } from "../combat-extras/testing";
import { attackCommand } from "./attack";
import { rollDamageCommand } from "./damage";
import { applyCard, undoCommand } from "./hp";
import { setRemoved } from "./initiative";

const I = CHARX_INTENTS;

/** CBTX's started ambush (round 1) + Mira's Light crossbow and three spells. */
function setup() {
  const t = cbtxSetup();
  const put = (creatureId: string, list: string, row: object) =>
    t.run<{ rowId: string }>(I.putRow, { creatureId, list, row }).rowId;
  const crossbow = put(t.miraId, "attacks", {
    name: "Light crossbow",
    toHit: 4,
    damage: "1d8+2",
    damageType: "piercing",
  });
  // WIS 12 (+1) + proficiency 2 → spell attack +3, save DC 11.
  t.run(I.edit, {
    creatureId: t.miraId,
    set: { spellcasting: { ability: "wis", slots: { "1": 2 } } },
  });
  const bolt = put(t.miraId, "spells", {
    name: "Guiding Bolt",
    level: 1,
    roll: "attack",
    damage: "4d6",
    damageType: "radiant",
  });
  const flame = put(t.miraId, "spells", {
    name: "Sacred Flame",
    level: 0,
    roll: "save",
    saveAbility: "dex",
    damage: "1d8",
    damageType: "radiant",
  });
  const cure = put(t.miraId, "spells", {
    name: "Cure Wounds",
    level: 1,
    roll: "none",
    effect: "healing",
    damage: "1d8+1",
  });
  const p1 = t.player(t.h.p1);
  const toHit = (attacker: string, d20: number, extra: object = {}, actor: Actor = p1) =>
    t.run<AttackResult>(
      attackCommand.name,
      { attackerId: t.id(attacker), rolls: "toHit", manual: [{ diceTotal: d20 }], ...extra },
      actor,
    );
  const damage = (attacker: string, dice: number, extra: object = {}, actor: Actor = p1) =>
    t.run<RollDamageResult>(
      rollDamageCommand.name,
      { attackerId: t.id(attacker), manual: { diceTotal: dice }, ...extra },
      actor,
    );
  const card = (cardId: string) => {
    const r = t.s.db.select().from(notification).where(eq(notification.id, cardId)).get();
    if (!r) throw new Error(`no card ${cardId}`);
    return { ...r, p: DamageCardPayload.parse(r.payload) };
  };
  const entries = () =>
    t.s.db
      .select()
      .from(gameLogEntry)
      .orderBy(asc(gameLogEntry.n))
      .all() as unknown as GameLogEntryRecord[];
  const lastEntry = () => entries().at(-1) as GameLogEntryRecord;
  const rollRow = (id: string) => t.s.db.select().from(roll).where(eq(roll.id, id)).get();
  const hpRows = () => t.s.db.select().from(hpChange).all() as HpChangeRecord[];
  const apply = (cardId: string, input: object) =>
    t.run<HpChangesResult>(applyCard.name, { cardId, ...input });
  const target = (name: string, hit: boolean, multiplier = "normal") => ({
    targetId: t.id(name),
    hit,
    multiplier,
  });
  const lines = (dm: boolean) =>
    entries()
      .filter((e) => e.kind === "cbt.attack")
      .map((e) =>
        lineText(
          attackLogKind.formatLine({
            actorName: e.actorName,
            payload: e.payload,
            ...(dm ? { dmPayload: e.dmPayload } : {}),
          } as Parameters<typeof attackLogKind.formatLine>[0]),
        ),
      );
  const written = () => [t.count("roll"), t.count("game_log_entry"), t.count("notification")];
  return {
    ...t,
    p1,
    crossbow,
    bolt,
    flame,
    cure,
    toHit,
    damage,
    card,
    lastEntry,
    rollRow,
    hpRows,
    apply,
    target,
    lines,
    written,
  };
}

describe("FR-CBT-70 to-hit-only card", () => {
  test("FR-CBT-70 player Attack (rolls: toHit) → card damage null, text, one public to-hit line", () => {
    const t = setup();
    const n = t.events.length;
    const r = t.toHit("Mira", 11, { attackId: t.crossbow });
    expect(t.typesSince(n)).toEqual(["AttackRolled", "NotificationCreated"]);
    expect(r.rollIds).toHaveLength(1);
    const c = t.card(r.cardId);
    expect(c.p).toMatchObject({ toHit: { total: 15 }, damage: null, attackId: t.crossbow });
    expect(c.text).toBe("Mira: 15 to hit (Light crossbow)");
    expect(c).toMatchObject({ state: "pending", audience: "player", audiencePlayerId: t.h.p1.id });
    expect(t.lastEntry()).toMatchObject({ category: "attack", public: true, rollIds: r.rollIds });
  });

  test("FR-CBT-70 FR-CBT-57 natural 20 marker; DM's to-hit-only line is DM-only (FR-CBT-52)", () => {
    const t = setup();
    const r = t.toHit("Goblin", 20, {}, t.h.dm);
    expect(t.card(r.cardId)).toMatchObject({
      text: "Goblin: 24 to hit (natural 20) (Scimitar)",
      audience: "dm",
    });
    expect(t.card(r.cardId).p.crit).toBe(true);
    expect(t.lastEntry().public).toBe(false);
  });

  test("FR-CBT-70 manual: one entry with rolls toHit, else invalid; nothing written", () => {
    const t = setup();
    const before = t.written();
    const e = t.err(() =>
      t.toHit("Mira", 11, { manual: [{ diceTotal: 11 }, { diceTotal: 4 }] }, t.p1),
    );
    expect(e.code).toBe("invalid");
    expect(t.written()).toEqual(before);
  });
});

describe("FR-CBT-71 cbt.rollDamage", () => {
  test("FR-CBT-71 completes the latest pending to-hit-only card of the row: DamageRolled + NotificationUpdated, same seq", () => {
    const t = setup();
    const a = t.toHit("Mira", 11, { attackId: t.crossbow });
    const before = t.card(a.cardId);
    const n = t.events.length;
    const d = t.damage("Mira", 5, { attackId: t.crossbow });
    expect(t.typesSince(n)).toEqual(["DamageRolled", "NotificationUpdated"]);
    expect(d).toMatchObject({ cardId: a.cardId, attached: true });
    const after = t.card(a.cardId);
    expect(after.text).toBe("Mira: 15 to hit, 7 piercing");
    expect(after.p.damage).toMatchObject({ total: 7, rollId: d.rollIds[0] });
    expect([after.seq, after.audience, after.state]).toEqual([before.seq, "player", "pending"]);
    expect(t.lastEntry()).toMatchObject({ category: "damage", public: true, rollIds: d.rollIds });
    expect(t.rollRow(d.rollIds[0] as string)?.label).toBe("Light crossbow damage (piercing)");
  });

  test("FR-CBT-71 natural 20 → doubled dice; manual checked against the doubled expression", () => {
    const t = setup();
    const a = t.toHit("Mira", 20, { attackId: t.crossbow });
    // 1d8 can't total 14; 2d8 can.
    const d = t.damage("Mira", 14, { attackId: t.crossbow });
    expect(t.rollRow(d.rollIds[0] as string)?.expression).toBe("2d8+2");
    expect(t.card(a.cardId).text).toBe("Mira: 24 to hit (natural 20), 16 piercing (critical)");
  });

  test("FR-CBT-71 no pending to-hit card of that row → damage-only card; a second Damage → another", () => {
    const t = setup();
    t.toHit("Mira", 11, { attackId: t.crossbow });
    const n = t.events.length;
    // Another row (the first attack, Shortsword): no card of its own → damage-only.
    const d = t.damage("Mira", 4);
    expect(t.typesSince(n)).toEqual(["DamageRolled", "NotificationCreated"]);
    expect(d.attached).toBe(false);
    const c = t.card(d.cardId);
    expect(c.text).toBe("Mira: 6 piercing (Shortsword)");
    expect(c.p).toMatchObject({ toHit: null, damage: { total: 6 }, crit: false });
    const again = t.damage("Mira", 3);
    expect(again.attached).toBe(false);
    expect(again.cardId).not.toBe(d.cardId);
  });

  test("FR-CBT-71 the latest pending to-hit-only card wins; a resolved one is never completed", () => {
    const t = setup();
    const first = t.toHit("Mira", 11, { attackId: t.crossbow });
    const second = t.toHit("Mira", 12, { attackId: t.crossbow });
    expect(t.damage("Mira", 5, { attackId: t.crossbow }).cardId).toBe(second.cardId);
    expect(t.damage("Mira", 5, { attackId: t.crossbow }).cardId).toBe(first.cardId);
    expect(t.damage("Mira", 5, { attackId: t.crossbow }).attached).toBe(false);
  });

  test("FR-CBT-71 save spell → damage-only card with its DC; healing never makes a card", () => {
    const t = setup();
    const d = t.damage("Mira", 5, { spellId: t.flame });
    const c = t.card(d.cardId);
    expect(c.text).toBe("Mira: 5 radiant (Sacred Flame) — DC 11 DEX");
    expect(c.p).toMatchObject({ spellId: t.flame, saveDc: { dc: 11, ability: "dex" } });
    const before = t.written();
    const e = t.err(() => t.damage("Mira", 5, { spellId: t.cure }));
    expect(e.code).toBe("conflict");
    expect(t.written()).toEqual(before);
  });

  test("FR-CBT-71 spell attack: Damage completes the spell's to-hit card", () => {
    const t = setup();
    const a = t.toHit("Mira", 10, { spellId: t.bolt });
    const d = t.damage("Mira", 12, { spellId: t.bolt });
    expect(d).toMatchObject({ cardId: a.cardId, attached: true });
    expect(t.card(a.cardId).text).toBe("Mira: 13 to hit, 12 radiant");
  });

  test("FR-CBT-71 the DM's rollDamage for Mira completes player-1's card; its line follows the owner's rule (public)", () => {
    const t = setup();
    const a = t.toHit("Mira", 11, { attackId: t.crossbow });
    const d = t.damage("Mira", 5, { attackId: t.crossbow }, t.h.dm);
    expect(d).toMatchObject({ cardId: a.cardId, attached: true });
    expect(t.card(a.cardId).audience).toBe("player");
    expect(t.lastEntry().public).toBe(true);
    // A DM card or a new DM card → DM-only.
    const g = t.toHit("Goblin", 9, {}, t.h.dm);
    expect(t.damage("Goblin", 3, {}, t.h.dm).cardId).toBe(g.cardId);
    expect(t.lastEntry().public).toBe(false);
    t.damage("Goblin", 3, {}, t.h.dm);
    expect(t.lastEntry().public).toBe(false);
  });

  test("FR-CBT-71 player: own visible PC only; removed attacker → not_found; nothing written", () => {
    const t = setup();
    const before = t.written();
    expect(t.err(() => t.damage("Thorn", 3)).code).toBe("forbidden");
    expect(t.err(() => t.damage("Goblin", 3)).code).toBe("forbidden");
    expect(t.err(() => t.damage("Mira", 3, { attackId: "gone" })).code).toBe("not_found");
    t.run(setRemoved.name, { combatantId: t.id("Mira"), removed: true });
    expect(t.err(() => t.damage("Mira", 3)).code).toBe("not_found");
    expect(t.written()).toEqual(before);
  });
});

describe("FR-CBT-72 / -73 apply partial cards", () => {
  test("FR-CBT-72 to-hit-only, every target misses, no damageTotal → applied; line '— miss'", () => {
    const t = setup();
    const a = t.toHit("Mira", 2, { attackId: t.crossbow });
    t.apply(a.cardId, { toHitTotal: 6, targets: [t.target("Goblin", false)] });
    expect(t.card(a.cardId).state).toBe("resolved");
    expect(t.hpRows().at(-1)).toMatchObject({
      hit: false,
      raw: 0,
      damageRolled: null,
      toHitRolled: 6,
    });
    expect(t.lines(false).at(-1)).toBe("Mira attacks Goblin: 2 + 4 = 6 (physical) — miss");
  });

  test("FR-CBT-72 to-hit-only with a hit and no total → invalid; a typed total = DM set", () => {
    const t = setup();
    const a = t.toHit("Mira", 15, { attackId: t.crossbow });
    const e = t.err(() =>
      t.apply(a.cardId, { toHitTotal: 19, targets: [t.target("Goblin", true)] }),
    );
    expect([e.code, e.message]).toEqual(["invalid", "Damage needed"]);
    t.apply(a.cardId, { toHitTotal: 19, damageTotal: 5, targets: [t.target("Goblin", true)] });
    expect(t.hpRows().at(-1)).toMatchObject({ damageRolled: null, damageTotal: 5, raw: 5 });
    expect(t.lines(true).at(-1)).toBe(
      "Mira attacks Goblin: 15 + 4 = 19 (physical) vs AC 15 — hit! 5 piercing damage (DM set)",
    );
    expect(t.lines(false).at(-1)).toBe(
      "Mira attacks Goblin: 15 + 4 = 19 (physical) — hit! 5 piercing damage",
    );
  });

  test("FR-CBT-72 / -73 damage-only apply: null to-hit facts; 'Mira → Goblin' lines; undo reopens", () => {
    const t = setup();
    const d = t.damage("Mira", 4);
    const e = t.err(() =>
      t.apply(d.cardId, { toHitTotal: 10, damageTotal: 6, targets: [t.target("Goblin", true)] }),
    );
    expect(e.code).toBe("invalid");
    const r = t.apply(d.cardId, {
      damageTotal: 6,
      targets: [t.target("Goblin", true, "half"), t.target("Goblin 2", true)],
    });
    expect(t.hpRows().slice(-2)).toMatchObject([
      { toHitRolled: null, toHitTotal: null, natural: null, hitComputed: null, raw: 3 },
      { toHitRolled: null, raw: 6, damageRolled: 6 },
    ]);
    expect(t.lines(false).slice(-2)).toEqual([
      "Mira → Goblin: 3 piercing damage (half) (Shortsword) (physical)",
      "Mira → Goblin 2: 6 piercing damage (Shortsword) (physical)",
    ]);
    expect(t.lines(true).at(-1)).toBe(
      "Mira → Goblin 2: 6 piercing damage (Shortsword) (1d6+2: 4 + 2) (physical)",
    );
    t.run(undoCommand.name, { expectedHpChangeId: r.hpChangeIds.at(-1) });
    expect(t.card(d.cardId).state).toBe("pending");
  });

  test("FR-CBT-34 a full card still needs both totals", () => {
    const t = setup();
    const a = t.run<AttackResult>(attackCommand.name, {
      attackerId: t.id("Goblin"),
      manual: [{ diceTotal: 15 }, { diceTotal: 4 }],
    });
    const targets = [t.target("Mira", false)];
    for (const totals of [{ toHitTotal: 19 }, { damageTotal: 6 }, {}]) {
      expect(t.err(() => t.apply(a.cardId, { targets, ...totals })).code).toBe("invalid");
    }
    expect(t.card(a.cardId).state).toBe("pending");
  });
});
