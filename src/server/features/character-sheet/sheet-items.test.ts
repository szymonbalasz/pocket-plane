// CHARX `sheet-items.ts` (seams S8, OQ-PARTY-17): pure row rules for item moves (decrement,
// merge / append, caps) and the write touching only `items`.
import { describe, expect, test } from "bun:test";
import type { ItemRow } from "@shared/character-sheet/sheet";
import { ITEM_QTY_MAX, SHEET_ITEM_MAX } from "@shared/party-board/schemas";
import { addSheetItem, decrementSheetItem } from "./sheet-items";

const row = (id: string, name: string, qty: number, over: Partial<ItemRow> = {}): ItemRow => ({
  id,
  name,
  qty,
  equipped: false,
  notes: "",
  ...over,
});
const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe("CHARX sheet-items helper (FR-PARTY-22)", () => {
  test("FR-PARTY-22 decrement: reduce, delete at 0 incl. equipped; gone; short", () => {
    const items = [row("a", "Bolts", 20), row("b", "Shortsword", 1, { equipped: true })];
    expect(decrementSheetItem(items, "a", 5)).toMatchObject({
      kind: "ok",
      items: [row("a", "Bolts", 15), items[1]],
    });
    expect(decrementSheetItem(items, "b", 1)).toMatchObject({ kind: "ok", items: [items[0]] });
    expect(decrementSheetItem(items, "zz", 1)).toEqual({ kind: "gone" });
    expect(decrementSheetItem(items, "b", 2)).toEqual({ kind: "short", held: 1 });
    expect(decrementSheetItem([row("c", "Flask", 0)], "c", 1)).toEqual({ kind: "short", held: 0 });
  });

  test("FR-PARTY-22 add: merge by key (name ci + trimmed, notes exact) keeping name / equipped / place; else append unequipped", () => {
    const items = [
      row("a", "Bolts", 20, { equipped: true }),
      row("b", "Rope", 1, { notes: "50 ft" }),
    ];
    expect(addSheetItem(items, { name: " bolts ", qty: 5, notes: "" }, ids())).toEqual({
      kind: "ok",
      rowId: "a",
      items: [row("a", "Bolts", 25, { equipped: true }), items[1] as ItemRow],
    });
    const appended = addSheetItem(items, { name: "Rope", qty: 2, notes: "" }, ids());
    expect(appended).toEqual({
      kind: "ok",
      rowId: "new-1",
      items: [...items, row("new-1", "Rope", 2)],
    });
  });

  test("FR-PARTY-22 caps: 80 rows, qty 9 999", () => {
    const full = Array.from({ length: SHEET_ITEM_MAX }, (_, i) => row(`r${i}`, `Thing ${i}`, 1));
    expect(addSheetItem(full, { name: "New", qty: 1, notes: "" }, ids())).toEqual({
      kind: "conflict",
      reason: "rows",
    });
    // A merge still fits a full sheet.
    expect(addSheetItem(full, { name: "thing 3", qty: 1, notes: "" }, ids()).kind).toBe("ok");
    expect(
      addSheetItem([row("a", "Arrow", ITEM_QTY_MAX)], { name: "Arrow", qty: 1, notes: "" }, ids()),
    ).toEqual({ kind: "conflict", reason: "qty" });
  });
});
