// Pure party-inventory rules (FR-PARTY-18–23): merge key, merge / take plans with caps, and the
// move authorization matrix. The server applies the plans at commit; the clients mirror them.
import {
  ITEM_QTY_MAX,
  type ItemEnd,
  onlyLeftMessage,
  PARTY_FULL_MESSAGE,
  PARTY_ITEM_MAX,
  SHEET_ITEM_MAX,
} from "./schemas";

/** The fields the merge rule reads; party rows and sheet `items` rows both fit. */
export interface ItemLike {
  name: string;
  notes: string;
  qty: number;
}

/** FR-PARTY-18 merge key: `name` trimmed, case-insensitive; `notes` exact. */
export function itemKey(item: { name: string; notes: string }): string {
  return JSON.stringify([item.name.trim().toLowerCase(), item.notes]);
}

export function sameItemKey(
  a: { name: string; notes: string },
  b: { name: string; notes: string },
) {
  return itemKey(a) === itemKey(b);
}

export type MergePlan<R> =
  | { kind: "merge"; row: R; qty: number }
  | { kind: "append" }
  | { kind: "conflict"; reason: "qty" | "rows" };

/**
 * FR-PARTY-19 / FR-PARTY-22 target side: merge into the row with the same key (new qty ≤ 9 999)
 * or append (rows < `maxRows`). Caps: party 60, sheet 80.
 */
export function planMerge<R extends ItemLike>(
  rows: readonly R[],
  item: ItemLike,
  maxRows: number,
): MergePlan<R> {
  const row = rows.find((r) => sameItemKey(r, item));
  if (row) {
    const qty = row.qty + item.qty;
    return qty > ITEM_QTY_MAX ? { kind: "conflict", reason: "qty" } : { kind: "merge", row, qty };
  }
  return rows.length >= maxRows ? { kind: "conflict", reason: "rows" } : { kind: "append" };
}

export type TakePlan = { kind: "ok"; remaining: number; deleted: boolean } | { kind: "conflict" };

/** FR-PARTY-21 / FR-PARTY-22 source side: reduce by `qty`; deleted at 0; more than held → conflict. */
export function planTake(held: number, qty: number): TakePlan {
  if (qty > held) return { kind: "conflict" };
  const remaining = held - qty;
  return { kind: "ok", remaining, deleted: remaining === 0 };
}

/** FR-PARTY-21 / FR-PARTY-22: "Only ‹n› left". */
export const takeConflictMessage = onlyLeftMessage;

/**
 * FR-PARTY-22 cap conflicts naming the full side: party rows → FR-PARTY-19's text; otherwise
 * "‹side› …". `side` = "Party" or the character's name.
 */
export function mergeConflictMessage(
  reason: "qty" | "rows",
  target: ItemEnd,
  side: string,
): string {
  if (reason === "qty") return `${side} can't hold more than ${ITEM_QTY_MAX} of this item`;
  return target.kind === "party"
    ? PARTY_FULL_MESSAGE
    : `${side}'s inventory is full (${SHEET_ITEM_MAX})`;
}

/** Row cap of a move's target side (FR-PARTY-22). */
export const rowCapOf = (end: ItemEnd) => (end.kind === "party" ? PARTY_ITEM_MAX : SHEET_ITEM_MAX);

/** FR-PARTY-20: another row (not `itemId`) with the edited key → `conflict`. */
export function editKeyClash<R extends ItemLike & { id: string }>(
  rows: readonly R[],
  itemId: string,
  item: { name: string; notes: string },
): R | undefined {
  return rows.find((r) => r.id !== itemId && sameItemKey(r, item));
}

/**
 * FR-PARTY-23 (as FR-LOOT-07): DM any move. Player: own character → `party` or another
 * character; `party` → own character. `ownCharacterIds` = characters the player owns at commit.
 */
export function canMoveItem(
  role: "dm" | "player",
  from: ItemEnd,
  to: ItemEnd,
  ownCharacterIds: readonly string[],
): boolean {
  if (role === "dm") return true;
  const own = (e: ItemEnd) => e.kind === "character" && ownCharacterIds.includes(e.characterId);
  if (from.kind === "character") return own(from);
  return own(to);
}
