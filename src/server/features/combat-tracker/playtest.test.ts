// CBT §13 integration (playtest, #171): the DM's own attack roll line (FR-CBT-52) and the
// outcome line's physical tags + DM-only dice (FR-CBT-53), in process with player views.
import { describe, expect, test } from "bun:test";
import { type AttackLogDmPayload, attackLogKind } from "@shared/combat-tracker/log-kinds";
import {
  AttackInput,
  type AttackResult,
  type HpChangesResult,
  parseFullCard,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import {
  GAME_LOG_ENTRY_TYPE,
  type GameLogEntryRecord,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { gameLogEntry, hpChange, notification } from "../../db/schema";
import { attackCommand } from "./attack";
import { applyCard, undoCommand } from "./hp";
import { startCommand } from "./lifecycle";
import { combatSetup } from "./testing";

function started() {
  const t = combatSetup();
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  const id = (name: string) => t.byName(enc.id)[name]?.id as string;
  const entries = () => t.s.db.select().from(gameLogEntry).all() as GameLogEntryRecord[];
  const cardPayload = (cardId: string) =>
    parseFullCard(
      t.s.db.select().from(notification).where(eq(notification.id, cardId)).get()?.payload,
    );
  const players = [t.h.viewer("player", t.h.p1.id), t.h.viewer("player", t.h.p2.id)];
  return { ...t, enc, id, entries, cardPayload, players };
}

describe("FR-CBT-52 DM attack roll line", () => {
  test("FR-CBT-52 DM cbt.attack (manual) → one DM-only roll entry in AttackRolled, even with Attack public", () => {
    const t = started();
    t.run("dice.setCategoryPublic", { category: "attack", public: true });
    const n = t.events.length;
    const r = t.run<AttackResult>(attackCommand.name, {
      attackerId: t.id("Goblin"),
      mode: "advantage",
      manual: [{ diceTotal: 9, dice: [9, 3] }, { diceTotal: 4 }],
    });
    const ev = t.events[n]?.event;
    expect(ev?.type).toBe("AttackRolled");
    const lines = (ev?.changes ?? []).filter((c) => c.type === GAME_LOG_ENTRY_TYPE);
    expect(lines).toHaveLength(1);
    const e = lines[0]?.after as GameLogEntryRecord;
    expect(e).toMatchObject({
      kind: "roll",
      category: "attack",
      public: false,
      actorName: "Goblin",
      rollerRole: "dm",
      encounterId: t.enc.id,
      rollIds: r.rollIds,
    });
    const items = e.payload as RollPayloadItem[];
    expect(items.map((i) => [i.label, i.manual, i.mode])).toEqual([
      ["Scimitar attack", true, "advantage"],
      ["Scimitar damage (slashing)", true, "normal"],
    ]);
    expect(items[0]?.dice.map((d) => [d.value, d.kept])).toEqual([
      [9, true],
      [3, false],
    ]);
    // Players never receive it (the filter drops a non-public entry).
    for (const v of t.players) {
      expect(lines.map((c) => t.s.records.filterChange(c, v)).filter(Boolean)).toEqual([]);
    }
  });

  test("FR-CBT-52 any DM-sent attack, PC too (hidden PC, absent player); player attack stays public", () => {
    const t = started();
    t.run("map.setTokenHidden", { tokenId: t.tokens.thorn, hidden: true });
    t.run(attackCommand.name, { attackerId: t.id("Thorn") });
    t.run(attackCommand.name, { attackerId: t.id("Mira") });
    t.run(attackCommand.name, { attackerId: t.id("Mira") }, t.p1);
    const attacks = t.entries().filter((e) => e.category === "attack");
    expect(attacks.map((e) => [e.actorName, e.rollerRole, e.public])).toEqual([
      ["Thorn", "dm", false],
      ["Mira", "dm", false],
      ["Mira", "player", true],
    ]);
  });

  test("FR-CBT-52 card + entry in one transaction: rollback → neither", () => {
    const t = started();
    const failing = defineCommand({
      name: "test.attackThenFail",
      input: AttackInput,
      execute(input, env) {
        attackCommand.execute(input, env);
        throw conflict("caller failed");
      },
    });
    t.s.commands.register(failing);
    const counts = () => [t.count("roll"), t.count("game_log_entry"), t.count("notification")];
    const before = counts(); // Start's monster initiative rolls (FR-CBT-64)
    expect(t.err(() => t.run(failing.name, { attackerId: t.id("Goblin") })).code).toBe("conflict");
    expect(counts()).toEqual(before);
  });

  test("FR-CBT-52 the roll line stays after Undo and after Dismiss (rolls are facts)", () => {
    const t = started();
    const r = t.run<AttackResult>(attackCommand.name, {
      attackerId: t.id("Goblin"),
      manual: [{ diceTotal: 15 }, { diceTotal: 4 }],
    });
    const rollLine = t.entries().find((e) => e.category === "attack") as GameLogEntryRecord;
    const p = t.cardPayload(r.cardId);
    const res = t.run<HpChangesResult>(applyCard.name, {
      cardId: r.cardId,
      toHitTotal: p.toHit.total,
      damageTotal: p.damage.total,
      targets: [{ targetId: t.id("Mira"), hit: true, multiplier: "normal" }],
    });
    t.run(undoCommand.name, { expectedHpChangeId: res.hpChangeIds[0] });
    const after = t.entries().find((e) => e.id === rollLine.id);
    expect(after?.undone).toBe(false);
    const r2 = t.run<AttackResult>(attackCommand.name, { attackerId: t.id("Goblin") });
    t.run("note.dismiss", { id: r2.cardId });
    expect(t.entries().filter((e) => e.kind === "roll" && e.category === "attack")).toHaveLength(2);
  });
});

describe("FR-CBT-53 outcome line detail", () => {
  function applied(opts: { mode?: string; hit?: boolean; toHitTotal?: number; damage?: number }) {
    const t = started();
    t.run("dice.setCategoryPublic", { category: "attack", public: true });
    const r = t.run<AttackResult>(attackCommand.name, {
      attackerId: t.id("Goblin"),
      mode: opts.mode ?? "normal",
      manual:
        opts.mode === "advantage"
          ? [{ diceTotal: 15, dice: [7, 15] }, { diceTotal: 4 }]
          : [{ diceTotal: 9 }, { diceTotal: 4 }],
    });
    const p = t.cardPayload(r.cardId);
    const n = t.events.length;
    t.run<HpChangesResult>(applyCard.name, {
      cardId: r.cardId,
      toHitTotal: opts.toHitTotal ?? p.toHit.total,
      damageTotal: opts.damage ?? p.damage.total,
      targets: [{ targetId: t.id("Mira"), hit: opts.hit ?? true, multiplier: "normal" }],
    });
    const change = t.events[n]?.event.changes.find((c) => c.type === GAME_LOG_ENTRY_TYPE);
    const entry = change?.after as GameLogEntryRecord;
    const players = t.players.map(
      (v) =>
        t.s.records.filterChange(change as NonNullable<typeof change>, v)?.data as
          | Record<string, unknown>
          | undefined,
    );
    return { t, entry, players };
  }
  const dmText = (e: GameLogEntryRecord) =>
    lineText(
      attackLogKind.formatLine({
        actorName: e.actorName,
        payload: e.payload,
        dmPayload: e.dmPayload,
      }),
    );
  const playerText = (data: Record<string, unknown> | undefined) =>
    lineText(
      attackLogKind.formatLine({ actorName: data?.actorName as string, payload: data?.payload }),
    );

  test("FR-CBT-53 apply → DM entry has dmPayload.rolls with per-die values; physical flags public", () => {
    const { t, entry } = applied({ mode: "advantage" });
    expect(entry.payload).toMatchObject({ manual: { toHit: true, damage: true } });
    const dm = entry.dmPayload as AttackLogDmPayload;
    expect(dm.rolls).toEqual({
      toHit: {
        expression: "2d20kh1+4",
        mode: "advantage",
        dice: [
          [7, false],
          [15, true],
        ],
        constant: 4,
      },
      damage: { expression: "1d6+2", dice: [[4, true]], constant: 2, crit: false },
    });
    // The stored row matches what was broadcast.
    const row = t.s.db.select().from(gameLogEntry).where(eq(gameLogEntry.id, entry.id)).get();
    expect(row?.dmPayload).toEqual(dm);
    expect(t.count("hp_change")).toBe(1);
    expect(t.s.db.select().from(hpChange).all()[0]?.entryId).toBe(entry.id);
  });

  test("FR-CBT-53 step 9a: DM ruled hit vs computed miss; player copy has physical, no dmPayload", () => {
    const { entry, players } = applied({ hit: true }); // 9 + 4 = 13 vs Mira's AC 16
    expect(dmText(entry)).toBe(
      "Goblin attacks Mira: 9 + 4 = 13 vs AC 16 — DM ruled hit 6 slashing damage (1d6+2: 4 + 2) (physical)",
    );
    for (const data of players) {
      expect(data).toBeDefined();
      expect(data && "dmPayload" in data ? data.dmPayload : undefined).toBeUndefined();
      expect(data?.payload).toMatchObject({ manual: { toHit: true, damage: true } });
      expect(playerText(data)).toBe(
        "Goblin attacks Mira: 9 + 4 = 13 — DM: hit. 6 slashing damage (physical)",
      );
      const raw = JSON.stringify(data);
      for (const leak of ['"rolls"', "DM ruled", "DM set", "targetAc"]) {
        expect(raw).not.toContain(leak);
      }
    }
  });

  test("FR-CBT-53 DM set totals: 'DM set; rolled N' on the DM's line only", () => {
    const { entry, players } = applied({ toHitTotal: 18, damage: 9 });
    expect(dmText(entry)).toBe(
      "Goblin attacks Mira: 18 (DM set; rolled 13) vs AC 16 — hit! 9 slashing damage (DM set; rolled 6) (1d6+2: 4 + 2) (physical)",
    );
    expect(playerText(players[0])).toBe(
      "Goblin attacks Mira: 18 — DM: hit. 9 slashing damage (physical)",
    );
  });

  test("FR-CBT-53 DM ruled miss", () => {
    const { entry } = applied({ toHitTotal: 20, hit: false });
    expect(dmText(entry)).toBe(
      "Goblin attacks Mira: 20 (DM set; rolled 13) vs AC 16 — DM ruled miss",
    );
  });
});
