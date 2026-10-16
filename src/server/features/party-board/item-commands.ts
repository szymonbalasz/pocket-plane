// Party inventory commands of slice 4 (PARTY §6.3): `party.editItem` / `party.removeItem` (DM) and
// `party.moveItem` (DM, player). A move's party row, sheet row(s) and loot-log row commit in one
// transaction; sheet writes go through CHARX's `sheet-items.ts` and touch only `items` (seams S8).
import type { CharacterRecord } from "@shared/entities/schemas";
import { ItemMoved, PartyItemEdited, PartyItemRemoved } from "@shared/events/party-board";
import {
  canMoveItem,
  editKeyClash,
  type MergePlan,
  mergeConflictMessage,
  planMerge,
  planTake,
} from "@shared/party-board/items";
import {
  EditItemIntent,
  ITEM_CLASH_MESSAGE,
  ITEM_GONE_MESSAGE,
  type ItemEnd,
  type ItemEntryResult,
  ItemName,
  ItemNotes,
  MoveItemIntent,
  onlyLeftMessage,
  PARTY_ITEM_MAX,
  PARTY_ITEM_TYPE,
  type PartyItemRecord,
  RemoveItemIntent,
} from "@shared/party-board/schemas";
import { LOOT_ENTRY_TYPE } from "@shared/party-loot/schemas";
import { eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { partyItem, partyItemSeqNext } from "../../db/schema";
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
import { campaignOf, getItem, PARTY_INTENTS } from "./commands";
import { listPartyItems } from "./rows";

const WORLD = { kind: "world" } as const;
const PARTY = { kind: "party" } as const;
export const MOVE_FORBIDDEN = "You can't move that item";

const sameValues = (a: PartyItemRecord, b: { name: string; qty: number; notes: string }) =>
  a.name === b.name && a.qty === b.qty && a.notes === b.notes;
const values = (r: { name: string; qty: number; notes: string }) => ({
  name: r.name,
  qty: r.qty,
  notes: r.notes,
});

/**
 * FR-PARTY-20: full replacement, no log row, no notification; another row with the new key →
 * `conflict`; same values → `ack`, no event.
 */
export const editItem = defineCommand({
  name: PARTY_INTENTS.editItem,
  input: EditItemIntent,
  execute({ itemId, ...input }, env): void {
    const cid = campaignOf(env);
    const before = getItem(env, cid, itemId);
    if (sameValues(before, input)) return;
    if (editKeyClash(listPartyItems(env.tx, cid), itemId, input))
      throw conflict(ITEM_CLASH_MESSAGE);
    env.tx
      .update(partyItem)
      .set({ ...input, updatedAt: env.ctx.clock.iso() })
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

/** Party row reduced by `qty` (deleted at 0), or "Only ‹n› left"; its change. */
function takeFromParty(env: CommandEnv, row: PartyItemRecord, qty: number): RecordChange {
  const plan = planTake(row.qty, qty);
  if (plan.kind === "conflict") throw conflict(onlyLeftMessage(row.qty));
  if (plan.deleted) {
    env.tx.delete(partyItem).where(eq(partyItem.id, row.id)).run();
    return { type: PARTY_ITEM_TYPE, id: row.id, before: row, after: null };
  }
  env.tx
    .update(partyItem)
    .set({ qty: plan.remaining, updatedAt: env.ctx.clock.iso() })
    .where(eq(partyItem.id, row.id))
    .run();
  return {
    type: PARTY_ITEM_TYPE,
    id: row.id,
    before: row,
    after: getItem(env, row.campaignId, row.id),
  };
}

/**
 * FR-PARTY-21 (sold / used up): row qty − `qty`, deleted at 0; more than held → `conflict`.
 * Writes a `loot-entry` kind `item` `party → world`. Result `{entryId}`.
 */
export const removeItem = defineCommand({
  name: PARTY_INTENTS.removeItem,
  input: RemoveItemIntent,
  execute({ itemId, qty }, env): ItemEntryResult {
    const cid = campaignOf(env);
    const row = getItem(env, cid, itemId);
    const change = takeFromParty(env, row, qty);
    const entry = insertItemEntry(env, cid, PARTY, WORLD, row.name, qty);
    env.emit({
      type: PartyItemRemoved.type,
      campaignId: cid,
      payload: { itemId, entryId: entry.id, name: row.name, qty },
      changes: [change, { type: LOOT_ENTRY_TYPE, id: entry.id, before: null, after: entry }],
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
 * FR-PARTY-22 / FR-PARTY-23: `from` reduced (deleted at 0, incl. an equipped sheet row), `to`
 * merged by key or appended (sheet: `equipped: false`); caps per side → `conflict` naming it.
 * Authorization at commit (own = `ownerPlayerId`); sheet lock and draft status don't block.
 * Changes: `party-item`, each changed `creature-sheet`, `loot-entry`. Result `{entryId}`.
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
    const sheetOf = (e: ItemEnd & { kind: "character" }) =>
      readSheetItems(env, chars.get(e.characterId) as CharacterRecord);

    // Source side: what moves (name, notes) and its change.
    let item: { name: string; notes: string };
    let partyChange: RecordChange | null = null;
    let fromSheet: { s: SheetItems; items: SheetItems["items"] } | null = null;
    if (from.kind === "party") {
      const row = getItem(env, cid, input.itemId as string);
      item = { name: row.name, notes: row.notes };
      partyChange = takeFromParty(env, row, qty);
    } else {
      const s = sheetOf(from);
      const take = decrementSheetItem(s.items, input.rowId as string, qty);
      if (take.kind === "gone") throw notFound(ITEM_GONE_MESSAGE);
      if (take.kind === "short") throw conflict(onlyLeftMessage(take.held));
      item = to.kind === "party" ? cleanItem(take.row.name, take.row.notes) : take.row;
      fromSheet = { s, items: take.items };
    }

    // Target side: merge by key or append; caps name the full side.
    const moving = { name: item.name, notes: item.notes, qty };
    let toSheet: { s: SheetItems; items: SheetItems["items"] } | null = null;
    if (to.kind === "party") {
      const plan = planMerge(listPartyItems(env.tx, cid), moving, PARTY_ITEM_MAX);
      if (plan.kind === "conflict") throw conflict(mergeConflictMessage(plan.reason, to, "Party"));
      partyChange = putToParty(env, cid, plan, moving);
    } else {
      const s = sheetOf(to);
      const put = addSheetItem(s.items, moving, () => env.ctx.ids.next());
      if (put.kind === "conflict") {
        const name = (chars.get(to.characterId) as CharacterRecord).name;
        throw conflict(mergeConflictMessage(put.reason, to, name));
      }
      toSheet = { s, items: put.items };
    }

    const changes: RecordChange[] = [];
    if (partyChange) changes.push(partyChange);
    for (const side of [fromSheet, toSheet]) {
      if (!side) continue;
      const ch = writeSheetItems(env, side.s, side.items);
      if (ch) changes.push(ch);
    }
    const entry = insertItemEntry(env, cid, from, to, item.name, qty);
    changes.push({ type: LOOT_ENTRY_TYPE, id: entry.id, before: null, after: entry });
    env.emit({
      type: ItemMoved.type,
      campaignId: cid,
      payload: { entryId: entry.id, from, to, name: item.name, qty },
      changes,
    });
    return { entryId: entry.id };
  },
});

/** Party target side of a move: merge into `plan.row` or insert a new row. */
function putToParty(
  env: CommandEnv,
  cid: string,
  plan: Exclude<MergePlan<PartyItemRecord>, { kind: "conflict" }>,
  item: { name: string; notes: string; qty: number },
): RecordChange {
  const now = env.ctx.clock.iso();
  if (plan.kind === "merge") {
    env.tx
      .update(partyItem)
      .set({ qty: plan.qty, updatedAt: now })
      .where(eq(partyItem.id, plan.row.id))
      .run();
    return {
      type: PARTY_ITEM_TYPE,
      id: plan.row.id,
      before: plan.row,
      after: getItem(env, cid, plan.row.id),
    };
  }
  const id = env.ctx.ids.next();
  env.tx
    .insert(partyItem)
    .values({
      id,
      campaignId: cid,
      seq: partyItemSeqNext,
      name: item.name,
      qty: item.qty,
      notes: item.notes,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { type: PARTY_ITEM_TYPE, id, before: null, after: getItem(env, cid, id) };
}
