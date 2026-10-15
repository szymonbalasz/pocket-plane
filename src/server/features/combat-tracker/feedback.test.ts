// CBT feedback pass (FR-CBT-34–40, FR-CBT-44): multi-target apply, undo unit, removed for
// players, movement used (ADR-0031), checks and saves. In-process; WS paths in sync.test.ts.
import { describe, expect, test } from "bun:test";
import { resolutionText, undoGroup } from "@shared/combat-tracker/rules";
import {
  type AttackResult,
  COMBATANT_TYPE,
  DamageCardResolutionRead,
  type HpChangeRecord,
  type HpChangesResult,
  parseFullCard,
  type RollAbilityResult,
} from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { SCN_INTENTS } from "@shared/scene-tools/schemas";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { gameLogEntry, hpChange, notification, roll } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor } from "../../events/types";
import { UPDATE } from "../entities/commands";
import { WALL_BLOCKED } from "../scene-tools/guard";
import { rollAbility } from "./abilities";
import { attackCommand } from "./attack";
import { applyCard, applyHp, undoCommand } from "./hp";
import { setInitiative, setRemoved } from "./initiative";
import { endCommand, startCommand } from "./lifecycle";
import { readEncounter } from "./rows";
import { combatSetup, eliteBlock } from "./testing";
import { nextTurn, prevTurn } from "./turns";

function started() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  t.run(MAP_INTENTS.activateScene, { sceneId: t.sceneId });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const row = (name: string) => t.byName(enc.id)[name];
  const card = (cardId: string) =>
    t.s.db.select().from(notification).where(eq(notification.id, cardId)).get();
  const attack = (name: string, toHit: number, damage: number, actor = t.h.dm) =>
    t.run<AttackResult>(
      attackCommand.name,
      { attackerId: id(name), manual: [{ diceTotal: toHit }, { diceTotal: damage }] },
      actor,
    );
  const apply = (
    cardId: string,
    targets: [string, boolean, string][],
    o: Record<string, unknown> = {},
  ) => {
    const p = parseFullCard(card(cardId)?.payload);
    return t.run<HpChangesResult>(applyCard.name, {
      cardId,
      toHitTotal: p.toHit.total,
      damageTotal: p.damage.total,
      targets: targets.map(([n, hit, multiplier]) => ({ targetId: id(n), hit, multiplier })),
      ...o,
    });
  };
  const hpRows = () => t.s.db.select().from(hpChange).all() as HpChangeRecord[];
  const entry = (eid: string) =>
    t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, eid)).get();
  const undo = () => {
    const last = hpRows()
      .filter((r) => !r.undone)
      .sort((a, b) => b.seq - a.seq)[0];
    return t.run<HpChangesResult>(undoCommand.name, { expectedHpChangeId: last?.id ?? "x" });
  };
  const enc0 = () => readEncounter(t.s.db, enc.id);
  const turn = (dir: "next" | "prev") => {
    const e = enc0();
    t.run(dir === "next" ? nextTurn.name : prevTurn.name, {
      encounterId: e.id,
      expectedRound: e.round,
      expectedTurnId: e.turnCombatantId,
    });
  };
  const standard = () => {
    for (const [n, v] of [
      ["Wolf", 18],
      ["Mira", 15],
      ["Goblin", 12],
      ["Goblin 2", 11],
      ["Thorn", 10],
      ["Elite Goblin Warrior", 8],
    ] as const) {
      t.run(setInitiative.name, { combatantId: id(n), value: v });
    }
  };
  const move = (tokenId: string, col: number, rowN: number, actor?: Actor) =>
    t.run(MAP_INTENTS.moveToken, { tokenId, col, row: rowN }, actor);
  const wire = (changes: readonly { type: string }[], v: ReturnType<typeof t.h.viewer>) =>
    changes.map((c) => t.s.records.filterChange(c as never, v)).filter(Boolean);
  return {
    ...t,
    enc,
    id,
    row,
    card,
    attack,
    apply,
    hpRows,
    entry,
    undo,
    enc0,
    turn,
    standard,
    move,
    wire,
  };
}

const types = (t: ReturnType<typeof started>, from: number) =>
  t.events.slice(from).map((e) => e.event.type);

describe("FR-CBT-34 FR-CBT-36 multi-target apply", () => {
  test("FR-CBT-34 two targets (one hidden): 2 rows, 2 lines, 2 AttackApplied + 1 resolve, one tx", () => {
    const t = started();
    t.run("dice.setCategoryPublic", { category: "attack", public: true });
    const r = t.attack("Mira", 15, 4, t.p1); // 19 to hit, 6 piercing
    const n = t.events.length;
    const res = t.apply(r.cardId, [
      ["Goblin", true, "normal"],
      ["Wolf", true, "half"],
    ]);
    expect(types(t, n)).toEqual(["AttackApplied", "AttackApplied", "NotificationResolved"]);
    const rows = t.hpRows();
    expect(res.hpChangeIds).toEqual(rows.map((x) => x.id));
    expect(rows.map((x) => [x.targetName, x.multiplier, x.raw, x.applied, x.cardId])).toEqual([
      ["Goblin", "normal", 6, 6, r.cardId],
      ["Wolf", "half", 3, 3, r.cardId],
    ]);
    // FR-CBT-36: one line per target, same roll ids; the hidden target's line is DM-only.
    const lines = rows.map((x) => t.entry(x.entryId));
    expect(lines.map((e) => [e?.kind, e?.public])).toEqual([
      ["cbt.attack", true],
      ["cbt.attack", false],
    ]);
    expect(lines[0]?.rollIds).toEqual(r.rollIds);
    expect(lines[1]?.rollIds).toEqual(r.rollIds);
    // One event per row, payload per row (FR-CBT-23).
    expect(t.events[n]?.event.payload).toMatchObject({ hpChangeId: rows[0]?.id, targetAc: 15 });
    expect(t.events[n + 1]?.event.payload).toMatchObject({ hpChangeId: rows[1]?.id, targetAc: 13 });
    // Resolution: apply order, hidden target unnamed; the rolling player reads it.
    const resolution = t.card(r.cardId)?.resolution;
    expect(resolution).toEqual({
      targets: [
        { targetName: "Goblin", hit: true, multiplier: "normal", applied: 6 },
        { targetName: null, hit: true, multiplier: "half", applied: 3 },
      ],
    });
    expect(resolutionText(DamageCardResolutionRead.parse(resolution).targets)).toBe(
      "Hit Goblin: 6 · Hit: 3 (half)",
    );
    // Players: Goblin's band + its public line; nothing of Wolf.
    const v = t.h.viewer("player", t.h.p2.id);
    const all = [t.events[n], t.events[n + 1]].flatMap((e) => t.wire(e?.event.changes ?? [], v));
    expect(all.map((w) => w?.type)).toEqual([COMBATANT_TYPE, GAME_LOG_ENTRY_TYPE]);
    expect(JSON.stringify(all)).not.toContain("Wolf");
  });

  test("FR-CBT-34 a removed target, an unknown one, a duplicate or > 20 → nothing written", () => {
    const t = started();
    const r = t.attack("Goblin", 10, 3);
    t.run(setRemoved.name, { combatantId: t.id("Goblin 2"), removed: true });
    const before = {
      rows: t.hpRows().length,
      lines: t.count("game_log_entry"),
      ev: t.events.length,
    };
    const code = (fn: () => unknown) => t.err(fn).code;
    expect(
      code(() =>
        t.apply(r.cardId, [
          ["Mira", true, "normal"],
          ["Goblin 2", true, "normal"],
        ]),
      ),
    ).toBe("not_found");
    const base = { cardId: r.cardId, toHitTotal: 13, damageTotal: 5 };
    const tgt = (targetId: string) => ({ targetId, hit: true, multiplier: "normal" });
    expect(
      code(() => t.run(applyCard.name, { ...base, targets: [tgt(t.id("Mira")), tgt("x")] })),
    ).toBe("not_found");
    expect(
      code(() =>
        t.run(applyCard.name, { ...base, targets: [tgt(t.id("Mira")), tgt(t.id("Mira"))] }),
      ),
    ).toBe("invalid");
    const many = Array.from({ length: 21 }, (_, i) => tgt(`k${i}`));
    expect(code(() => t.run(applyCard.name, { ...base, targets: many }))).toBe("invalid");
    expect(code(() => t.run(applyCard.name, { ...base, targets: [] }))).toBe("invalid");
    expect(t.hpRows()).toHaveLength(before.rows);
    expect(t.count("game_log_entry")).toBe(before.lines);
    expect(t.events.length).toBe(before.ev);
    expect(t.row("Mira")).toBeDefined();
    expect(t.card(r.cardId)?.state).toBe("pending");
  });

  test("FR-CBT-34 per-target hit and multiplier: miss = 0, none = 0, double; PC via adjustHp", () => {
    const t = started();
    const r = t.attack("Elite Goblin Warrior", 10, 4); // 15 to hit, 7 slashing
    t.apply(r.cardId, [
      ["Goblin", false, "normal"],
      ["Goblin 2", true, "none"],
      ["Mira", true, "double"],
    ]);
    expect(t.hpRows().map((x) => [x.targetName, x.hit, x.raw, x.applied, x.hpAfter])).toEqual([
      ["Goblin", false, 0, 0, 7],
      ["Goblin 2", true, 0, 0, 7],
      ["Mira", true, 14, 12, 0],
    ]);
    // Hidden attacker → no line is public.
    expect(t.hpRows().every((x) => t.entry(x.entryId)?.public === false)).toBe(true);
  });
});

describe("FR-CBT-35 undo unit = one apply", () => {
  test("FR-CBT-35 undo of a 2-target apply: both rows, 2 CombatEntryUndone (latest first), 1 reopen", () => {
    const t = started();
    t.run(applyHp.name, { combatantId: t.id("Thorn"), kind: "damage", amount: 2 });
    const r = t.attack("Goblin", 10, 3); // 14, 5
    t.apply(r.cardId, [
      ["Mira", true, "normal"],
      ["Goblin 2", true, "half"],
    ]);
    const [direct, a, b] = t.hpRows();
    const n = t.events.length;
    const res = t.undo();
    expect(res.hpChangeIds).toEqual([b?.id as string, a?.id as string]);
    expect(types(t, n)).toEqual(["CombatEntryUndone", "CombatEntryUndone", "NotificationReopened"]);
    expect(t.events[n]?.event.payload).toEqual({ hpChangeId: b?.id });
    expect(t.events[n + 1]?.event.payload).toEqual({ hpChangeId: a?.id });
    expect(t.row("Goblin 2")?.hpCurrent).toBe(7);
    expect(t.hpRows().map((x) => x.undone)).toEqual([false, true, true]);
    expect(t.entry(a?.entryId as string)?.undone).toBe(true);
    expect(t.entry(b?.entryId as string)?.undone).toBe(true);
    expect(t.card(r.cardId)).toMatchObject({ state: "pending", resolution: null });
    // Expected guard: the old latest id (b) is gone; the direct row is next, alone.
    expect(t.err(() => t.run(undoCommand.name, { expectedHpChangeId: b?.id })).code).toBe(
      "conflict",
    );
    expect(t.undo().hpChangeIds).toEqual([direct?.id as string]);
    expect(t.err(() => t.undo()).message).toBe("Nothing to undo");
    // Re-apply the reopened card: a new apply, a new undo unit.
    t.apply(r.cardId, [["Goblin", true, "normal"]]);
    expect(t.undo().hpChangeIds).toHaveLength(1);
  });

  test("FR-CBT-35 undoGroup: latest + same card, latest first; direct alone; undone skipped", () => {
    const r = (id: string, seq: number, cardId: string | null, undone = false) => ({
      id,
      seq,
      cardId,
      undone,
    });
    expect(undoGroup([])).toEqual([]);
    const rows = [r("a", 1, "c1"), r("b", 2, null), r("c", 3, "c2"), r("d", 4, "c2")];
    expect(undoGroup(rows).map((x) => x.id)).toEqual(["d", "c"]);
    expect(undoGroup([...rows.slice(0, 2)]).map((x) => x.id)).toEqual(["b"]);
    expect(undoGroup([r("a", 1, "c1"), r("b", 2, "c1", true)]).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("FR-CBT-37 removed, for players", () => {
  test("FR-CBT-37 remove → redacted upsert; hidden removed stays hidden; End → delete", () => {
    const t = started();
    const v = t.h.viewer("player", t.h.p1.id);
    t.run(setRemoved.name, { combatantId: t.id("Goblin"), removed: true });
    const snap = t.h.snapshot(v)[COMBATANT_TYPE] as Record<string, unknown>[];
    const gob = snap.find((c) => c.name === "Goblin");
    expect(gob).toEqual({
      id: t.id("Goblin"),
      encounterId: t.enc.id,
      kind: "monster",
      tokenId: t.tokens.goblin,
      name: "Goblin",
      imageAssetId: t.row("Goblin")?.imageAssetId,
      removed: true,
      movedFt: 0,
    });
    // Hidden + removed: never sent.
    t.run(setRemoved.name, { combatantId: t.id("Wolf"), removed: true });
    expect(
      t.wire(t.events.at(-1)?.event.changes ?? [], v).some((w) => w?.id === t.id("Wolf")),
    ).toBe(false);
    t.run(endCommand.name, { encounterId: t.enc.id });
    const end = t.wire(t.events.at(-1)?.event.changes ?? [], v);
    expect(end).toContainEqual({ type: COMBATANT_TYPE, id: t.id("Goblin"), op: "delete" });
  });
});

describe("FR-CBT-39 FR-CBT-40 movement used", () => {
  test("FR-CBT-39 DM move adds 5/10/5 distance in TokenMoved.changes; not logged", () => {
    const t = started();
    const n = t.events.length;
    t.move(t.tokens.goblin, 14, 8); // (12,6) → (14,8): 2 diagonals = 15 ft
    const ev = t.events[n]?.event;
    expect(ev?.type).toBe("TokenMoved");
    const c = ev?.changes.find((x) => x.type === COMBATANT_TYPE);
    expect(c?.after).toMatchObject({ id: t.id("Goblin"), movedFt: 15 });
    t.move(t.tokens.goblin, 14, 9); // +5
    expect(t.row("Goblin")?.movedFt).toBe(20);
    expect(readEventLog(t.s.db).some((e) => e.type === "TokenMoved")).toBe(false);
    // Players get the upsert (monster movedFt is an accepted leak).
    const w = t.wire(t.events.at(-1)?.event.changes ?? [], t.h.viewer("player", t.h.p2.id));
    expect(w.find((x) => x?.type === COMBATANT_TYPE)).toMatchObject({ data: { movedFt: 20 } });
  });

  test("FR-CBT-39 a player moving their own PC updates movedFt and is never rejected (ADR-0031)", () => {
    const t = started();
    t.move(t.tokens.mira, 6, 7, t.p1); // (2,7) → (6,7) = 20 ft
    t.move(t.tokens.mira, 10, 7, t.p1);
    expect(t.row("Mira")?.movedFt).toBe(40);
    // Removed: the move goes through, nothing gained.
    t.run(setRemoved.name, { combatantId: t.id("Mira"), removed: true });
    t.move(t.tokens.mira, 10, 8, t.p1);
    expect(t.row("Mira")?.movedFt).toBe(40);
  });

  test("FR-CBT-39 FR-SCN-30 movedFt follows the campaign's diagonal rule (map-settings)", () => {
    const t = started();
    t.run(SCN_INTENTS.setDiagonalRule, { rule: "5" });
    t.move(t.tokens.goblin, 14, 8); // (12,6) → (14,8): 2 diagonals = 10 ft under 5
    expect(t.row("Goblin")?.movedFt).toBe(10);
    t.run(SCN_INTENTS.setDiagonalRule, { rule: "5-10-5" });
    t.move(t.tokens.goblin, 16, 10); // 2 diagonals = 15 ft under 5/10/5
    expect(t.row("Goblin")?.movedFt).toBe(25);
  });

  test("FR-CBT-39 FR-SCN-11 a move refused by a wall adds nothing: no write, no event", () => {
    const t = started();
    t.run(SCN_INTENTS.addWalls, { sceneId: t.sceneId, segments: [[8, 0, 8, 14]] });
    const n = t.events.length;
    expect(() => t.move(t.tokens.mira, 10, 7, t.p1)).toThrow(WALL_BLOCKED);
    expect(t.row("Mira")?.movedFt).toBe(0);
    expect(t.events.length).toBe(n);
    t.move(t.tokens.mira, 6, 7, t.p1); // same side: 20 ft
    expect(t.row("Mira")?.movedFt).toBe(20);
  });

  test("FR-CBT-39 cap 9,999; inactive after End unchanged", () => {
    const t = started();
    t.s.db.$client.run("update combatant set moved_ft = 9995 where id = ?", [t.id("Goblin")]);
    t.move(t.tokens.goblin, 13, 6);
    expect(t.row("Goblin")?.movedFt).toBe(9999);
    t.run(endCommand.name, { encounterId: t.enc.id });
    const n = t.events.length;
    t.move(t.tokens.goblin, 12, 6);
    expect(t.row("Goblin")?.movedFt).toBe(9999);
    expect(t.events[n]?.event.changes.some((c) => c.type === COMBATANT_TYPE)).toBe(false);
  });

  test("FR-CBT-40 Next resets the new turn combatant (listed in TurnChanged); Prev keeps", () => {
    const t = started();
    t.standard();
    t.turn("next"); // round 1: Wolf
    t.move(t.tokens.mira, 3, 7, t.p1); // Mira 5 before her turn
    t.turn("next"); // Mira
    expect(t.row("Mira")?.movedFt).toBe(0);
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("TurnChanged");
    expect(ev?.changes.find((c) => c.type === COMBATANT_TYPE)?.after).toMatchObject({
      id: t.id("Mira"),
      movedFt: 0,
    });
    t.move(t.tokens.mira, 4, 7, t.p1);
    t.turn("next"); // Goblin
    t.turn("prev"); // back to Mira: kept
    expect(t.row("Mira")?.movedFt).toBe(5);
    expect(t.events.at(-1)?.event.changes.some((c) => c.type === COMBATANT_TYPE)).toBe(false);
    // Next with nothing to reset lists only the encounter.
    t.turn("next");
    expect(t.events.at(-1)?.event.changes.map((c) => c.type)).toEqual(["encounter"]);
  });
});

describe("FR-CBT-38 PC Down for other players (FR-ENT-15)", () => {
  test("FR-CBT-38 Mira at 0 HP → player-2 gets the redacted entity with down: true, no HP", () => {
    const t = started();
    t.run(applyHp.name, { combatantId: t.id("Mira"), kind: "damage", amount: 99 });
    const ent = t.events.at(-1)?.event.changes.find((c) => c.type === "entity");
    const other = t.s.records.filterChange(ent as never, t.h.viewer("player", t.h.p2.id));
    expect(other?.data).toMatchObject({ id: t.miraId, down: true });
    expect(JSON.stringify(other)).not.toContain("hpCurrent");
    expect(JSON.stringify(other)).not.toContain("hpMax");
    t.undo();
    const back = t.events.at(-1)?.event.changes.find((c) => c.type === "entity");
    expect(
      t.s.records.filterChange(back as never, t.h.viewer("player", t.h.p2.id))?.data,
    ).toMatchObject({ down: false });
  });
});

describe("FR-CBT-44 cbt.rollAbility", () => {
  const rollOf = (t: ReturnType<typeof started>, id: string) =>
    t.s.db.select().from(roll).where(eq(roll.id, id)).get();

  test("FR-CBT-44 Goblin DEX save = 1d20+2, saving-throw, encounterId, CombatantRolled", () => {
    const t = started();
    const n = t.events.length;
    const r = t.run<RollAbilityResult>(rollAbility.name, {
      combatantId: t.id("Goblin"),
      kind: "save",
      ability: "dex",
      manual: { diceTotal: 11 },
    });
    expect(types(t, n)).toEqual(["CombatantRolled"]);
    expect(t.events[n]?.event.payload).toEqual({
      encounterId: t.enc.id,
      combatantId: t.id("Goblin"),
      kind: "save",
      ability: "dex",
      rollIds: r.rollIds,
      entryId: r.entryId,
    });
    expect(rollOf(t, r.rollIds[0] as string)).toMatchObject({
      expression: "1d20+2",
      category: "saving-throw",
      label: "Dexterity save",
      actorName: "Goblin",
      total: 13,
      source: "cbt",
    });
    expect(t.entry(r.entryId)).toMatchObject({
      kind: "roll",
      category: "saving-throw",
      encounterId: t.enc.id,
      public: false, // category off by default
    });
    const chk = t.run<RollAbilityResult>(rollAbility.name, {
      combatantId: t.id("Goblin"),
      kind: "check",
      ability: "str",
      public: true,
    });
    expect(rollOf(t, chk.rollIds[0] as string)).toMatchObject({
      expression: "1d20-1",
      category: "ability-check",
    });
    expect(t.entry(chk.entryId)?.public).toBe(true);
  });

  test("FR-CBT-44 hidden Wolf never public; Elite DEX save +2 proficiency; removed allowed", () => {
    const t = started();
    const w = t.run<RollAbilityResult>(rollAbility.name, {
      combatantId: t.id("Wolf"),
      kind: "save",
      ability: "wis",
      public: true,
    });
    expect(t.entry(w.entryId)?.public).toBe(false);
    const e = t.run<RollAbilityResult>(rollAbility.name, {
      combatantId: t.id("Elite Goblin Warrior"),
      kind: "save",
      ability: "dex",
    });
    expect(rollOf(t, e.rollIds[0] as string)?.expression).toBe("1d20+4");
    t.run(setRemoved.name, { combatantId: t.id("Goblin 2"), removed: true });
    t.run(rollAbility.name, { combatantId: t.id("Goblin 2"), kind: "check", ability: "dex" });
    expect(t.events.at(-1)?.event.type).toBe("CombatantRolled");
  });

  test("FR-CBT-44 no scores → conflict; player → forbidden; ended → not_found; nothing written", () => {
    const t = started();
    const { abilities: _a, saveProficiencies: _s, ...noScores } = eliteBlock;
    t.run(UPDATE, { id: t.eliteId, name: "Elite Goblin Warrior", statBlock: noScores });
    const rolls = t.count("roll");
    const input = { combatantId: t.id("Elite Goblin Warrior"), kind: "save", ability: "dex" };
    expect(t.err(() => t.run(rollAbility.name, input))).toMatchObject({
      code: "conflict",
      message: "No ability scores",
    });
    const mira = { combatantId: t.id("Mira"), kind: "check", ability: "str" };
    expect(t.err(() => t.run(rollAbility.name, mira, t.p1)).code).toBe("forbidden");
    t.run(endCommand.name, { encounterId: t.enc.id });
    expect(t.err(() => t.run(rollAbility.name, mira)).code).toBe("not_found");
    expect(t.count("roll")).toBe(rolls);
  });
});
