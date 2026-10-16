// PARTY §13 integration (in-process), slice 4: `party.editItem` / `removeItem` / `moveItem`, the
// authorization matrix (FR-PARTY-23), merge both ways, caps per side, sheet + party + log in one
// transaction (crash hook), conservation of item qty, and per-viewer changes of `ItemMoved`.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS, type ItemRow } from "@shared/character-sheet/sheet";
import {
  ITEM_CLASH_MESSAGE,
  ITEM_QTY_MAX,
  PARTY_FULL_MESSAGE,
  PARTY_ITEM_MAX,
  PARTY_ITEM_TYPE,
  SHEET_ITEM_MAX,
} from "@shared/party-board/schemas";
import { LOOT_ENTRY_TYPE, PARTY_POT_TYPE } from "@shared/party-loot/schemas";
import { asc, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { creatureSheet, entity, lootEntry, notification, partyItem } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, RecordChange } from "../../events/types";
import { addItem } from "./commands";
import { editItem, MOVE_FORBIDDEN, moveItem, removeItem } from "./item-commands";
import { type PartySeed, seedParty } from "./testing";

function fail(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return { code: e.code, message: e.message };
    throw e;
  }
  return { code: "ok", message: "" };
}

const add = (t: PartySeed, name: string, qty: number, notes = "") =>
  (t.run(addItem, { name, qty, notes }, { actor: t.dm }) as { itemId: string }).itemId;
const items = (t: PartySeed) => t.s.db.select().from(partyItem).orderBy(asc(partyItem.seq)).all();
const item = (t: PartySeed, id: string) =>
  t.s.db.select().from(partyItem).where(eq(partyItem.id, id)).get();
const sheet = (t: PartySeed, id: string) =>
  t.s.db.select().from(creatureSheet).where(eq(creatureSheet.entityId, id)).get();
const sheetItems = (t: PartySeed, id: string): ItemRow[] =>
  (sheet(t, id)?.items as ItemRow[] | undefined) ?? [];
const putRow = (t: PartySeed, creatureId: string, row: Partial<ItemRow> & { name: string }) =>
  (
    t.run(CHARX_INTENTS.putRow, { creatureId, list: "items", row }, { actor: t.dm }) as {
      rowId: string;
    }
  ).rowId;
const char = (characterId: string) => ({ kind: "character" as const, characterId });
const PARTY = { kind: "party" as const };
type Move = {
  from: { kind: "party" } | { kind: "character"; characterId: string };
  to: { kind: "party" } | { kind: "character"; characterId: string };
  qty: number;
  itemId?: string;
  rowId?: string;
};
const move = (t: PartySeed, input: Move, actor: Actor = t.dm) =>
  (t.run(moveItem, input, { actor }) as { entryId: string }).entryId;
const entries = (t: PartySeed) =>
  t.s.db
    .select()
    .from(lootEntry)
    .orderBy(asc(lootEntry.seq))
    .all()
    .filter((e) => e.kind === "item");
const types = (changes: RecordChange[] | undefined) =>
  changes?.map((c) => [c.type, c.after === null ? "delete" : "upsert"]);

describe("party.editItem (FR-PARTY-20)", () => {
  test("FR-PARTY-20 full replacement, no log row, no notification; same values → ack, no event", () => {
    const t = seedParty();
    const id = add(t, "Torch", 10);
    const logRows = entries(t).length;
    const notes = t.s.db.select().from(notification).all().length;
    t.events.length = 0;
    t.run(editItem, { itemId: id, name: " Torches ", qty: 12, notes: "damp" }, { actor: t.dm });
    expect(item(t, id)).toMatchObject({ name: "Torches", qty: 12, notes: "damp" });
    expect(t.events.map((e) => e.event.type)).toEqual(["PartyItemEdited"]);
    expect(t.events[0]?.event.payload).toEqual({
      itemId: id,
      before: { name: "Torch", qty: 10, notes: "" },
      after: { name: "Torches", qty: 12, notes: "damp" },
    });
    expect(types(t.events[0]?.event.changes)).toEqual([[PARTY_ITEM_TYPE, "upsert"]]);
    expect(entries(t)).toHaveLength(logRows);
    expect(t.s.db.select().from(notification).all()).toHaveLength(notes);
    t.events.length = 0;
    const log = readEventLog(t.s.db).length;
    t.run(editItem, { itemId: id, name: "Torches", qty: 12, notes: "damp" }, { actor: t.dm });
    expect(t.events).toHaveLength(0);
    expect(readEventLog(t.s.db)).toHaveLength(log);
  });

  test("FR-PARTY-20 a key clash with another row → conflict; unknown / other campaign → not_found; player → forbidden", () => {
    const t = seedParty();
    const torch = add(t, "Torch", 10);
    add(t, "Rope", 1, "50 ft");
    const clash = fail(() =>
      t.run(editItem, { itemId: torch, name: "ROPE", qty: 1, notes: "50 ft" }, { actor: t.dm }),
    );
    expect(clash).toEqual({ code: "conflict", message: ITEM_CLASH_MESSAGE });
    // Same name, other notes: a different key → fine.
    t.run(editItem, { itemId: torch, name: "Rope", qty: 3, notes: "" }, { actor: t.dm });
    expect(
      fail(() => t.run(editItem, { itemId: "nope", name: "X", qty: 1, notes: "" }, { actor: t.dm }))
        .code,
    ).toBe("not_found");
    expect(
      fail(() =>
        t.run(editItem, { itemId: torch, name: "X", qty: 1, notes: "" }, { actor: t.dmSecond }),
      ).code,
    ).toBe("not_found");
    expect(
      fail(() =>
        t.run(editItem, { itemId: torch, name: "X", qty: 1, notes: "" }, { actor: t.p1Actor }),
      ).code,
    ).toBe("forbidden");
    expect(
      fail(() => t.run(editItem, { itemId: torch, name: "", qty: 0, notes: "" }, { actor: t.dm }))
        .code,
    ).toBe("invalid");
  });
});

describe("party.removeItem (FR-PARTY-21)", () => {
  test("FR-PARTY-21 qty − n, deleted at 0; more than held → conflict 'Only ‹n› left'; party → world row", () => {
    const t = seedParty();
    const id = add(t, "Potion of healing", 2);
    t.events.length = 0;
    const r = t.run(removeItem, { itemId: id, qty: 1 }, { actor: t.dm }) as { entryId: string };
    expect(item(t, id)?.qty).toBe(1);
    expect(t.events.map((e) => e.event.type)).toEqual(["PartyItemRemoved"]);
    expect(t.events[0]?.event.payload).toEqual({
      itemId: id,
      entryId: r.entryId,
      name: "Potion of healing",
      qty: 1,
    });
    expect(types(t.events[0]?.event.changes)).toEqual([
      [PARTY_ITEM_TYPE, "upsert"],
      [LOOT_ENTRY_TYPE, "upsert"],
    ]);
    expect(entries(t).at(-1)).toMatchObject({
      id: r.entryId,
      fromKind: "party",
      toKind: "world",
      text: "Potion of healing",
      qty: 1,
      gp: 0,
    });
    expect(fail(() => t.run(removeItem, { itemId: id, qty: 2 }, { actor: t.dm }))).toEqual({
      code: "conflict",
      message: "Only 1 left",
    });
    t.events.length = 0;
    t.run(removeItem, { itemId: id, qty: 1 }, { actor: t.dm });
    expect(item(t, id)).toBeUndefined();
    expect(types(t.events[0]?.event.changes)).toEqual([
      [PARTY_ITEM_TYPE, "delete"],
      [LOOT_ENTRY_TYPE, "upsert"],
    ]);
    expect(fail(() => t.run(removeItem, { itemId: id, qty: 1 }, { actor: t.dm })).code).toBe(
      "not_found",
    );
    expect(fail(() => t.run(removeItem, { itemId: id, qty: 0 }, { actor: t.dm })).code).toBe(
      "invalid",
    );
    expect(fail(() => t.run(removeItem, { itemId: id, qty: 1 }, { actor: t.p1Actor })).code).toBe(
      "forbidden",
    );
    // FR-PARTY-21 adds no notification; pot unaffected.
    expect(t.events.map((e) => e.event.type)).toEqual(["PartyItemRemoved"]);
  });
});

describe("party.moveItem (FR-PARTY-22, FR-PARTY-23)", () => {
  test("FR-PARTY-22 party → character: appends unequipped, creates the sheet row; ItemMoved changes party-item, creature-sheet, loot-entry", () => {
    const t = seedParty();
    const torch = add(t, "Torch", 10);
    expect(sheet(t, t.thornId)).toBeUndefined();
    t.events.length = 0;
    const entryId = move(t, { from: PARTY, to: char(t.thornId), qty: 2, itemId: torch });
    expect(item(t, torch)?.qty).toBe(8);
    expect(sheetItems(t, t.thornId).map((i) => [i.name, i.qty, i.equipped, i.notes])).toEqual([
      ["Torch", 2, false, ""],
    ]);
    // A new sheet row: defaults otherwise (FR-CHARX-02), owner copy from the entity.
    expect(sheet(t, t.thornId)).toMatchObject({
      status: "ready",
      locked: false,
      ownerPlayerId: t.p2.id,
    });
    expect(t.events.map((e) => e.event.type)).toEqual(["ItemMoved"]);
    const ev = t.events[0]?.event;
    expect(ev?.payload).toEqual({
      entryId,
      from: PARTY,
      to: char(t.thornId),
      name: "Torch",
      qty: 2,
    });
    expect(types(ev?.changes)).toEqual([
      [PARTY_ITEM_TYPE, "upsert"],
      ["creature-sheet", "upsert"],
      [LOOT_ENTRY_TYPE, "upsert"],
    ]);
    expect(entries(t).at(-1)).toMatchObject({
      id: entryId,
      fromKind: "party",
      toKind: "character",
      toCharacterId: t.thornId,
      text: "Torch",
      qty: 2,
    });
    // No notification on a move; pot and wallets untouched.
    expect(ev?.changes.map((c) => c.type)).not.toContain(PARTY_POT_TYPE);
  });

  test("FR-PARTY-22 merge both ways by key (name ci + trimmed, notes exact); target keeps its row", () => {
    const t = seedParty();
    const bolts = putRow(t, t.miraId, { name: "Bolts", qty: 20, equipped: true });
    const partyBolts = add(t, "bolts", 3);
    // Sheet → party merges into "bolts".
    move(t, { from: char(t.miraId), to: PARTY, qty: 5, rowId: bolts });
    expect(item(t, partyBolts)).toMatchObject({ name: "bolts", qty: 8 });
    expect(items(t)).toHaveLength(1);
    expect(sheetItems(t, t.miraId)).toEqual([
      { id: bolts, name: "Bolts", qty: 15, equipped: true, notes: "" },
    ]);
    // Party → sheet merges into Mira's "Bolts" (keeps name, equipped).
    move(t, { from: PARTY, to: char(t.miraId), qty: 8, itemId: partyBolts });
    expect(item(t, partyBolts)).toBeUndefined();
    expect(sheetItems(t, t.miraId)).toEqual([
      { id: bolts, name: "Bolts", qty: 23, equipped: true, notes: "" },
    ]);
    // Notes differ → another key: appended.
    const rope = add(t, "Bolts", 2, "silvered");
    move(t, { from: PARTY, to: char(t.miraId), qty: 2, itemId: rope });
    expect(sheetItems(t, t.miraId).map((i) => [i.name, i.qty, i.notes, i.equipped])).toEqual([
      ["Bolts", 23, "", true],
      ["Bolts", 2, "silvered", false],
    ]);
  });

  test("FR-PARTY-22 source row deleted at 0, incl. an equipped sheet row; character → character", () => {
    const t = seedParty();
    const sword = putRow(t, t.miraId, { name: "Shortsword", qty: 1, equipped: true });
    const keep = putRow(t, t.miraId, { name: "Rations", qty: 3 });
    t.events.length = 0;
    move(t, { from: char(t.miraId), to: char(t.thornId), qty: 1, rowId: sword });
    expect(sheetItems(t, t.miraId).map((i) => i.id)).toEqual([keep]);
    expect(sheetItems(t, t.thornId).map((i) => [i.name, i.qty, i.equipped])).toEqual([
      ["Shortsword", 1, false],
    ]);
    // Both sheets change; no party-item change.
    expect(types(t.events[0]?.event.changes)).toEqual([
      ["creature-sheet", "upsert"],
      ["creature-sheet", "upsert"],
      [LOOT_ENTRY_TYPE, "upsert"],
    ]);
    expect(t.events[0]?.event.changes.map((c) => c.id).slice(0, 2)).toEqual([t.miraId, t.thornId]);
    const party = add(t, "Torch", 2);
    move(t, { from: PARTY, to: char(t.thornId), qty: 2, itemId: party });
    expect(item(t, party)).toBeUndefined();
  });

  test("FR-PARTY-22 not_found: unknown / other campaign character, a gone party row, rowId of another sheet", () => {
    const t = seedParty();
    const torch = add(t, "Torch", 1);
    const miraRow = putRow(t, t.miraId, { name: "Bolts", qty: 20 });
    const cases: [Move, string][] = [
      [{ from: PARTY, to: char("nope"), qty: 1, itemId: torch }, "Character not found"],
      [{ from: PARTY, to: char(t.strangerId), qty: 1, itemId: torch }, "Character not found"],
      [{ from: PARTY, to: char(t.miraId), qty: 1, itemId: "nope" }, "Item is gone"],
      [{ from: char(t.thornId), to: PARTY, qty: 1, rowId: miraRow }, "Item is gone"],
    ];
    for (const [input, message] of cases)
      expect(fail(() => move(t, input))).toEqual({ code: "not_found", message });
    // A monster is not a character end.
    const monster = t.s.db
      .select()
      .from(entity)
      .all()
      .find((e) => e.kind !== "character");
    if (monster)
      expect(
        fail(() => move(t, { from: PARTY, to: char(monster.id), qty: 1, itemId: torch })).code,
      ).toBe("not_found");
  });

  test("FR-PARTY-22 invalid: from = to, missing / extra ids, qty 0 / fractional / > 9 999, unknown keys", () => {
    const t = seedParty();
    const torch = add(t, "Torch", 1);
    const bad: unknown[] = [
      { from: PARTY, to: PARTY, qty: 1, itemId: torch },
      { from: char(t.miraId), to: char(t.miraId), qty: 1, rowId: "r" },
      { from: PARTY, to: char(t.miraId), qty: 1 },
      { from: PARTY, to: char(t.miraId), qty: 1, itemId: torch, rowId: "r" },
      { from: char(t.miraId), to: PARTY, qty: 1 },
      { from: char(t.miraId), to: PARTY, qty: 1, rowId: "r", itemId: torch },
      { from: PARTY, to: char(t.miraId), qty: 0, itemId: torch },
      { from: PARTY, to: char(t.miraId), qty: 1.5, itemId: torch },
      { from: PARTY, to: char(t.miraId), qty: ITEM_QTY_MAX + 1, itemId: torch },
      { from: PARTY, to: char(t.miraId), qty: 1, itemId: torch, extra: 1 },
      { from: { kind: "world" }, to: char(t.miraId), qty: 1, itemId: torch },
    ];
    for (const input of bad) expect(fail(() => move(t, input as Move)).code).toBe("invalid");
  });

  test("FR-PARTY-22 more than the source holds → conflict 'Only ‹n› left' (party and sheet)", () => {
    const t = seedParty();
    const potion = add(t, "Potion of healing", 2);
    const bolts = putRow(t, t.miraId, { name: "Bolts", qty: 3 });
    expect(
      fail(() => move(t, { from: PARTY, to: char(t.miraId), qty: 3, itemId: potion })),
    ).toEqual({ code: "conflict", message: "Only 2 left" });
    expect(fail(() => move(t, { from: char(t.miraId), to: PARTY, qty: 4, rowId: bolts }))).toEqual({
      code: "conflict",
      message: "Only 3 left",
    });
    expect(item(t, potion)?.qty).toBe(2);
    expect(sheetItems(t, t.miraId)[0]?.qty).toBe(3);
  });

  test("FR-PARTY-22 caps per side: party 60 rows, sheet 80 rows, qty 9 999 → conflict naming the full side", () => {
    const t = seedParty();
    for (let i = 0; i < PARTY_ITEM_MAX; i++) add(t, `Item ${i}`, 1);
    const gem = putRow(t, t.miraId, { name: "Gem", qty: 5 });
    expect(fail(() => move(t, { from: char(t.miraId), to: PARTY, qty: 1, rowId: gem }))).toEqual({
      code: "conflict",
      message: PARTY_FULL_MESSAGE,
    });
    // Party qty cap on a merge.
    const t2 = seedParty();
    add(t2, "Arrow", ITEM_QTY_MAX);
    const arrows = putRow(t2, t2.miraId, { name: "arrow", qty: 1 });
    expect(
      fail(() => move(t2, { from: char(t2.miraId), to: PARTY, qty: 1, rowId: arrows })),
    ).toEqual({
      code: "conflict",
      message: `Party can't hold more than ${ITEM_QTY_MAX} of this item`,
    });
    // Sheet rows cap (80) and qty cap name the character.
    const t3 = seedParty();
    for (let i = 0; i < SHEET_ITEM_MAX; i++) putRow(t3, t3.thornId, { name: `Thing ${i}`, qty: 1 });
    const torch = add(t3, "Torch", 1);
    expect(
      fail(() => move(t3, { from: PARTY, to: char(t3.thornId), qty: 1, itemId: torch })),
    ).toEqual({ code: "conflict", message: `Thorn's inventory is full (${SHEET_ITEM_MAX})` });
    putRow(t3, t3.miraId, { name: "Torch", qty: ITEM_QTY_MAX });
    expect(
      fail(() => move(t3, { from: PARTY, to: char(t3.miraId), qty: 1, itemId: torch })),
    ).toEqual({
      code: "conflict",
      message: `Mira can't hold more than ${ITEM_QTY_MAX} of this item`,
    });
    // Nothing changed on the failed moves.
    expect(item(t3, torch)?.qty).toBe(1);
    expect(sheetItems(t3, t3.thornId)).toHaveLength(SHEET_ITEM_MAX);
  });

  test("FR-PARTY-23 authorization matrix: DM any; player own → party / other, party → own; else forbidden", () => {
    const t = seedParty();
    const potion = add(t, "Potion of healing", 9);
    const mira = putRow(t, t.miraId, { name: "Bolts", qty: 20 });
    const thorn = putRow(t, t.thornId, { name: "Arrows", qty: 20 });
    const p1 = t.p1Actor; // owns Mira
    const ok: Move[] = [
      { from: char(t.miraId), to: PARTY, qty: 1, rowId: mira },
      { from: char(t.miraId), to: char(t.thornId), qty: 1, rowId: mira },
      { from: PARTY, to: char(t.miraId), qty: 1, itemId: potion },
    ];
    for (const input of ok) expect(fail(() => move(t, input, p1)).code).toBe("ok");
    const no: Move[] = [
      { from: PARTY, to: char(t.thornId), qty: 1, itemId: potion },
      { from: char(t.thornId), to: PARTY, qty: 1, rowId: thorn },
      { from: char(t.thornId), to: char(t.miraId), qty: 1, rowId: thorn },
    ];
    for (const input of no)
      expect(fail(() => move(t, input, p1))).toEqual({
        code: "forbidden",
        message: MOVE_FORBIDDEN,
      });
    // DM: any move, incl. between two characters neither owned.
    for (const input of no) expect(fail(() => move(t, input)).code).toBe("ok");
    // forbidden before not_found: a player probing another sheet's row learns nothing.
    expect(
      fail(() => move(t, { from: char(t.thornId), to: PARTY, qty: 1, rowId: "nope" }, p1)).code,
    ).toBe("forbidden");
  });

  test("FR-PARTY-23 own = ownerPlayerId at commit; sheet lock and draft status don't block", () => {
    const t = seedParty();
    const potion = add(t, "Potion of healing", 5);
    t.run(CHARX_INTENTS.setLock, { characterId: t.miraId, locked: true }, { actor: t.dm });
    expect(sheet(t, t.miraId)?.locked).toBe(true);
    move(t, { from: PARTY, to: char(t.miraId), qty: 1, itemId: potion }, t.p1Actor);
    const row = sheetItems(t, t.miraId)[0]?.id as string;
    move(t, { from: char(t.miraId), to: PARTY, qty: 1, rowId: row }, t.p1Actor);
    // A player's draft character.
    const draft = (
      t.run(
        CHARX_INTENTS.create,
        { name: "Brin", ownerPlayerId: t.p1.id, draft: true },
        { actor: t.dm },
      ) as { characterId: string }
    ).characterId;
    expect(sheet(t, draft)?.status).toBe("draft");
    move(t, { from: PARTY, to: char(draft), qty: 1, itemId: potion }, t.p1Actor);
    expect(sheetItems(t, draft)).toHaveLength(1);
    // Reassigned to player-2 → player-1 is refused at commit.
    t.run(
      CHARX_INTENTS.edit,
      { creatureId: draft, set: { ownerPlayerId: t.p2.id } },
      { actor: t.dm },
    );
    expect(
      fail(() => move(t, { from: PARTY, to: char(draft), qty: 1, itemId: potion }, t.p1Actor)).code,
    ).toBe("forbidden");
    expect(
      fail(() => move(t, { from: PARTY, to: char(draft), qty: 1, itemId: potion }, t.p2Actor)).code,
    ).toBe("ok");
  });

  test("FR-PARTY-22 sheet + party + log in one transaction: crash hook party.moveItem:before-commit → nothing changed", () => {
    const t = seedParty();
    const torch = add(t, "Torch", 10);
    const before = {
      items: items(t),
      sheet: sheet(t, t.thornId),
      entries: entries(t),
      log: readEventLog(t.s.db).length,
    };
    t.events.length = 0;
    armCrashHook({ point: "before-commit", target: "party.moveItem" }, (w) => {
      throw new Error(w);
    });
    try {
      expect(
        fail(() => move(t, { from: PARTY, to: char(t.thornId), qty: 2, itemId: torch })).code,
      ).toBe("internal");
    } finally {
      armCrashHook(null);
    }
    expect({
      items: items(t),
      sheet: sheet(t, t.thornId),
      entries: entries(t),
      log: readEventLog(t.s.db).length,
    }).toEqual(before);
    expect(t.events).toHaveLength(0);
  });

  test("FR-PARTY-22 conservation: Σ party + Σ sheets = Σ world ends (+ sheet starting qty) over a mixed sequence", () => {
    const t = seedParty();
    const chars = [t.miraId, t.thornId];
    putRow(t, t.miraId, { name: "Torch", qty: 4 });
    const startSheets = 4;
    add(t, "Torch", 20);
    // Deterministic LCG (no Math.random in server code).
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const total = () =>
      items(t)
        .filter((i) => i.name === "Torch")
        .reduce((a, i) => a + i.qty, 0) +
      chars
        .flatMap((c) => sheetItems(t, c))
        .filter((i) => i.name === "Torch")
        .reduce((a, i) => a + i.qty, 0);
    const worldNet = () =>
      entries(t)
        .filter((e) => e.text === "Torch")
        .reduce(
          (a, e) =>
            a +
            (e.fromKind === "world" ? (e.qty ?? 0) : 0) -
            (e.toKind === "world" ? (e.qty ?? 0) : 0),
          0,
        );
    let moves = 0;
    for (let i = 0; i < 60; i++) {
      const party = items(t).find((x) => x.name === "Torch");
      const c = chars[rnd(2)] as string;
      const row = sheetItems(t, c).find((x) => x.name === "Torch");
      const op = rnd(5);
      const r = fail(() => {
        if (op === 0) add(t, "Torch", 1 + rnd(3));
        else if (op === 1 && party)
          t.run(removeItem, { itemId: party.id, qty: 1 + rnd(2) }, { actor: t.dm });
        else if (op === 2 && party)
          move(t, { from: PARTY, to: char(c), qty: 1 + rnd(4), itemId: party.id });
        else if (op === 3 && row)
          move(t, { from: char(c), to: PARTY, qty: 1 + rnd(4), rowId: row.id });
        else if (row) {
          const other = chars.find((x) => x !== c) as string;
          move(t, { from: char(c), to: char(other), qty: 1 + rnd(3), rowId: row.id });
        }
      });
      if (r.code === "ok") moves++;
      else expect(["conflict", "not_found"]).toContain(r.code);
      expect(total()).toBe(worldNet() + startSheets);
    }
    expect(moves).toBeGreaterThan(20);
  });

  test("FR-PARTY-22 ItemMoved per viewer: party-item + loot-entry to everyone; the sheet only to its owner and the DM", () => {
    const t = seedParty();
    const potion = add(t, "Potion of healing", 2);
    t.events.length = 0;
    move(t, { from: PARTY, to: char(t.miraId), qty: 1, itemId: potion }, t.p1Actor);
    const changes = t.events[0]?.event.changes ?? [];
    const wire = (v: ReturnType<typeof t.viewer>) =>
      changes.map((c) => {
        const w = t.s.records.filterChange(c, v);
        return w ? `${w.type}:${w.op}` : null;
      });
    expect(wire(t.viewer("dm"))).toEqual([
      "party-item:upsert",
      "creature-sheet:upsert",
      "loot-entry:upsert",
    ]);
    expect(wire(t.viewer("player", t.p1.id))).toEqual([
      "party-item:upsert",
      "creature-sheet:upsert",
      "loot-entry:upsert",
    ]);
    expect(wire(t.viewer("player", t.p2.id))).toEqual([
      "party-item:upsert",
      null,
      "loot-entry:upsert",
    ]);
    // Other campaign: nothing.
    expect(wire(t.viewer("player", t.secondPlayerId, t.secondCampaignId))).toEqual([
      null,
      null,
      null,
    ]);
  });
});
