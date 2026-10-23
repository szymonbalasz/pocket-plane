// Party inventory commands of slice 4 (PARTY §6.3): `party.editItem` / `party.removeItem` (DM) and
// `party.moveItem` (DM, player). A move's party row, sheet row(s) and loot-log row commit in one
// transaction; sheet writes go through CHARX's `sheet-items.ts` and touch only `items` (seams S8).
// *(S9)* Stores rows and ends (FR-LOOT-36, -37): per-holder keys and caps, player rights with a
// visible Stores (FR-LOOT-33), DM-only Stores items (`not_found` to players, `item_hidden` on the
// entries that add / remove them), a `stores-coin` change per Stores end.
import type { CharacterRecord } from "@shared/entities/schemas";
import { ItemMoved, PartyItemEdited, PartyItemRemoved } from "@shared/events/party-board";
import { canMoveItem, editKeyClash, mergeConflictMessage } from "@shared/party-board/items";
import {
  EditItemIntent,
  ITEM_CLASH_MESSAGE,
  ITEM_GONE_MESSAGE,
  type ItemEnd,
  type ItemEntryResult,
  ItemName,
  ItemNotes,
  isItemTableEnd,
  MoveItemIntent,
  onlyLeftMessage,
  PARTY_ITEM_TYPE,
  type PartyItemRecord,
  RemoveItemIntent,
  sameItemEnd,
} from "@shared/party-board/schemas";
import { LOOT_ENTRY_TYPE } from "@shared/party-loot/schemas";
import { eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { partyItem } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import {
  addSheetItem,
  decrementSheetItem,
  readSheetItems,
  type SheetItems,
  writeSheetItems,
} from "../character-sheet/sheet-items";
import { getRow, toEntityRecord } from "../entities/rows";
import { insertItemEntry } from "../party-loot/item-entries";
import {
  requireStores,
  storesCoinChanges,
  storesCoinsBefore,
  storesIds,
} from "../party-loot/stores";
import { campaignOf, getItem, PARTY_INTENTS } from "./commands";
import { type HolderEnd, holderOf, putToHolder, takeFromHolder } from "./holders";
import { holderItems } from "./rows";

const WORLD = { kind: "world" } as const;
export const MOVE_FORBIDDEN = "You can't move that item";
const DM_ONLY_PARTY = "Only Stores items can be DM only";

const sameValues = (
  a: PartyItemRecord,
  b: { name: string; qty: number; notes: string },
  dmOnly: boolean,
) => a.name === b.name && a.qty === b.qty && a.notes === b.notes && (a.dmOnly === true) === dmOnly;
const values = (r: { name: string; qty: number; notes: string }) => ({
  name: r.name,
  qty: r.qty,
  notes: r.notes,
});

/**
 * FR-PARTY-20: full replacement, no log row, no notification; another row with the new key →
 * `conflict`; same values → `ack`, no event. *(S9)* Keys per holder; `dmOnly` on Stores rows only
 * (absent = kept; on a party row → `invalid`), FR-LOOT-37.
 */
export const editItem = defineCommand({
  name: PARTY_INTENTS.editItem,
  input: EditItemIntent,
  execute({ itemId, dmOnly, ...input }, env): void {
    const cid = campaignOf(env);
    const before = getItem(env, cid, itemId);
    const end = holderOf(before);
    if (end.kind === "party" && dmOnly === true) throw invalid(DM_ONLY_PARTY);
    const nextDmOnly = end.kind === "stores" && (dmOnly ?? before.dmOnly === true);
    if (sameValues(before, input, nextDmOnly)) return;
    const rows = holderItems(env.tx, cid, end.kind === "stores" ? end.strongholdId : null);
    if (editKeyClash(rows, itemId, input, nextDmOnly)) throw conflict(ITEM_CLASH_MESSAGE);
    env.tx
      .update(partyItem)
      .set({ ...input, dmOnly: nextDmOnly, updatedAt: env.ctx.clock.iso() })
      .where(eq(partyItem.id, itemId))
      .run();
    const after = getItem(env, cid, itemId);
    env.emit({
      type: PartyItemEdited.type,
      campaignId: cid,
      payload: { itemId, before: values(before), after: values(after) },
      changes: [{ type: PARTY_ITEM_TYPE, id: itemId, before, after }],
    });
  },
});

/**
 * FR-PARTY-21 (sold / used up): row qty − `qty`, deleted at 0; more than held → `conflict`.
 * Writes a `loot-entry` kind `item` `party → world` (*(S9)* `stores → world` for a Stores row,
 * hidden from players for a DM-only one). Result `{entryId}`.
 */
export const removeItem = defineCommand({
  name: PARTY_INTENTS.removeItem,
  input: RemoveItemIntent,
  execute({ itemId, qty }, env): ItemEntryResult {
    const cid = campaignOf(env);
    const row = getItem(env, cid, itemId);
    const end = holderOf(row);
    const stores = storesCoinsBefore(env, cid, storesIds(end));
    const change = takeFromHolder(env, row, qty);
    const entry = insertItemEntry(env, cid, end, WORLD, row.name, qty, row.dmOnly === true);
    env.emit({
      type: PartyItemRemoved.type,
      campaignId: cid,
      payload: { itemId, entryId: entry.id, name: row.name, qty },
      changes: [
        change,
        { type: LOOT_ENTRY_TYPE, id: entry.id, before: null, after: entry },
        ...storesCoinChanges(env, cid, stores),
      ],
    });
    return { entryId: entry.id };
  },
});

/** A character of the campaign (FR-PARTY-22), else `not_found`. */
function characterOf(env: CommandEnv, cid: string, id: string): CharacterRecord {
  const row = getRow(env.tx, id);
  if (!row || row.campaignId !== cid || row.kind !== "character")
    throw notFound("Character not found");
  const c = toEntityRecord(row);
  if (c.kind !== "character") throw notFound("Character not found");
  return c;
}

/** A sheet row's name / notes as party text (PARTY "clean text"); unusable → `invalid`. */
function cleanItem(name: string, notes: string): { name: string; notes: string } {
  const n = ItemName.safeParse(name);
  const o = ItemNotes.safeParse(notes);
  if (!n.success || !o.success) throw invalid("This item can't go to the party");
  return { name: n.data, notes: o.data };
}

/**
 * The `party_item` row a move takes from: in the campaign and in the `from` holder; a player
 * never takes a DM-only Stores item (`not_found`, FR-LOOT-36).
 */
function sourceRow(env: CommandEnv, cid: string, from: HolderEnd, itemId: string) {
  const row = getItem(env, cid, itemId);
  if (!sameItemEnd(holderOf(row), from)) throw notFound(ITEM_GONE_MESSAGE);
  if (env.actor.role === "player" && row.dmOnly) throw notFound(ITEM_GONE_MESSAGE);
  return row;
}

/**
 * FR-PARTY-22 / FR-PARTY-23: `from` reduced (deleted at 0, incl. an equipped sheet row), `to`
 * merged by key or appended (sheet: `equipped: false`); caps per side → `conflict` naming it.
 * Authorization at commit (own = `ownerPlayerId`); sheet lock and draft status don't block.
 * Changes: `party-item`, each changed `creature-sheet`, `loot-entry`, *(S9)* `stores-coin` per
 * Stores end. A DM-only Stores item stays DM-only only between Stores; moved out it shows.
 * Result `{entryId}`.
 */
export const moveItem = defineCommand({
  name: PARTY_INTENTS.moveItem,
  input: MoveItemIntent,
  roles: ["dm", "player"],
  execute(input, env): ItemEntryResult {
    const cid = campaignOf(env);
    const { from, to, qty } = input;
    const chars = new Map<string, CharacterRecord>();
    for (const e of [from, to]) {
      if (e.kind === "character") chars.set(e.characterId, characterOf(env, cid, e.characterId));
      // FR-LOOT-30 / -33: a gone Stores, or a hidden one for a player → `not_found`.
      if (e.kind === "stores") requireStores(env, cid, e.strongholdId);
    }
    if (env.actor.role === "player") {
      const me = env.actor.playerId;
      const own = [...chars.values()].filter((c) => me !== null && c.ownerPlayerId === me);
      if (
        !canMoveItem(
          "player",
          from,
          to,
          own.map((c) => c.id),
        )
      )
        throw forbidden(MOVE_FORBIDDEN);
    }
    const stores = storesCoinsBefore(env, cid, storesIds(from, to));
    const sheetOf = (e: ItemEnd & { kind: "character" }) =>
      readSheetItems(env, chars.get(e.characterId) as CharacterRecord);

    // Source side: what moves (name, notes) and its change.
    let item: { name: string; notes: string };
    let dmOnlyItem = false;
    const itemChanges: RecordChange[] = [];
    let fromSheet: { s: SheetItems; items: SheetItems["items"] } | null = null;
    if (from.kind !== "character") {
      const row = sourceRow(env, cid, from, input.itemId as string);
      item = { name: row.name, notes: row.notes };
      dmOnlyItem = row.dmOnly === true;
      itemChanges.push(takeFromHolder(env, row, qty));
    } else {
      const s = sheetOf(from);
      const take = decrementSheetItem(s.items, input.rowId as string, qty);
      if (take.kind === "gone") throw notFound(ITEM_GONE_MESSAGE);
      if (take.kind === "short") throw conflict(onlyLeftMessage(take.held));
      item = isItemTableEnd(to) ? cleanItem(take.row.name, take.row.notes) : take.row;
      fromSheet = { s, items: take.items };
    }

    // Target side: merge by key or append; caps name the full side.
    const moving = { name: item.name, notes: item.notes, qty };
    const staysHidden = dmOnlyItem && to.kind === "stores";
    let toSheet: { s: SheetItems; items: SheetItems["items"] } | null = null;
    if (to.kind !== "character") {
      itemChanges.push(putToHolder(env, cid, to, moving, staysHidden).change);
    } else {
      const s = sheetOf(to);
      const put = addSheetItem(s.items, moving, () => env.ctx.ids.next());
      if (put.kind === "conflict") {
        const name = (chars.get(to.characterId) as CharacterRecord).name;
        throw conflict(mergeConflictMessage(put.reason, to, name));
      }
      toSheet = { s, items: put.items };
    }

    const changes: RecordChange[] = [...itemChanges];
    for (const side of [fromSheet, toSheet]) {
      if (!side) continue;
      const ch = writeSheetItems(env, side.s, side.items);
      if (ch) changes.push(ch);
    }
    const entry = insertItemEntry(env, cid, from, to, item.name, qty, staysHidden);
    changes.push({ type: LOOT_ENTRY_TYPE, id: entry.id, before: null, after: entry });
    changes.push(...storesCoinChanges(env, cid, stores));
    env.emit({
      type: ItemMoved.type,
      campaignId: cid,
      payload: { entryId: entry.id, from, to, name: item.name, qty },
      changes,
    });
    return { entryId: entry.id };
  },
});
