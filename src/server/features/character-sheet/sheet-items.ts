// CHARX helper for `creature-sheet.items` writes from other features (seams S8, OQ-PARTY-17):
// party-board's `party.moveItem` decrements a source row and inserts / merges a target row in its
// own transaction. Touches only `items`; the whole row is still validated by `writeSheet` (row
// limits, 48 KB cap). Authorization, sheet lock and draft rules are the caller's: a move is a
// logged game action and neither blocks it (FR-PARTY-23). No event: the caller lists the change.
import type { CreatureSheetRecord, ItemRow } from "@shared/character-sheet/sheet";
import type { EntityRecord } from "@shared/entities/schemas";
import { type ItemLike, planMerge, planTake } from "@shared/party-board/items";
import { SHEET_ITEM_MAX } from "@shared/party-board/schemas";
import type { RecordChange } from "../../events/types";
import { getSheet, newSheet, type SheetEnv, writeSheet } from "./sheet-rows";

/** A creature's sheet as read for an items write; `before` null = no row yet (FR-CHARX-02). */
export interface SheetItems {
  creature: EntityRecord;
  before: CreatureSheetRecord | null;
  items: ItemRow[];
}

export function readSheetItems(env: SheetEnv, creature: EntityRecord): SheetItems {
  const before = getSheet(env.tx, creature.id);
  return { creature, before, items: before?.items ?? [] };
}

export type SheetTake =
  | { kind: "ok"; row: ItemRow; items: ItemRow[] }
  | { kind: "gone" }
  | { kind: "short"; held: number };

/** Row `rowId` reduced by `qty`; deleted at 0 (also when equipped). */
export function decrementSheetItem(
  items: readonly ItemRow[],
  rowId: string,
  qty: number,
): SheetTake {
  const row = items.find((r) => r.id === rowId);
  if (!row) return { kind: "gone" };
  const plan = planTake(row.qty, qty);
  if (plan.kind === "conflict") return { kind: "short", held: row.qty };
  const next = plan.deleted
    ? items.filter((r) => r.id !== rowId)
    : items.map((r) => (r.id === rowId ? { ...r, qty: plan.remaining } : r));
  return { kind: "ok", row, items: next };
}

export type SheetPut =
  | { kind: "ok"; rowId: string; items: ItemRow[] }
  | { kind: "conflict"; reason: "qty" | "rows" };

/**
 * Merge `item` into the row with the same key (PARTY merge key: name trimmed ci, notes exact;
 * the row keeps its name, `equipped` and place) or append `{equipped: false}` with `newId()`.
 * Caps: 80 rows (FR-CHARX-16), qty 9 999.
 */
export function addSheetItem(
  items: readonly ItemRow[],
  item: ItemLike,
  newId: () => string,
): SheetPut {
  const plan = planMerge(items, item, SHEET_ITEM_MAX);
  if (plan.kind === "conflict") return plan;
  if (plan.kind === "merge") {
    const id = plan.row.id;
    return {
      kind: "ok",
      rowId: id,
      items: items.map((r) => (r.id === id ? { ...r, qty: plan.qty } : r)),
    };
  }
  const row: ItemRow = {
    id: newId(),
    name: item.name,
    qty: item.qty,
    equipped: false,
    notes: item.notes,
  };
  return { kind: "ok", rowId: row.id, items: [...items, row] };
}

/** Writes `items` (the sheet row is created with defaults if missing); the `creature-sheet` change. */
export function writeSheetItems(
  env: SheetEnv,
  s: SheetItems,
  items: ItemRow[],
): RecordChange | null {
  const sheet = s.before ?? newSheet(env, s.creature);
  return writeSheet(env, s.before, { ...sheet, items });
}
