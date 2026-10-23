// `party_item` holders (FR-PARTY-19, -22; *(S9)* FR-LOOT-36, -37): the party inventory and each
// stronghold's Stores. Merge by key within one holder (a DM-only Stores row only with DM-only
// rows), caps per holder (60 each), reduce at the source (deleted at 0). Callers: `party.addItem`,
// `party.moveItem`, `party.removeItem`, `hold.delete` (Stores → party, FR-LOOT-38).
import {
  mergeConflictMessage,
  planHolderMerge,
  planTake,
  rowCapOf,
} from "@shared/party-board/items";
import {
  type ItemEnd,
  onlyLeftMessage,
  PARTY_ITEM_TYPE,
  type PartyItemRecord,
} from "@shared/party-board/schemas";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { partyItem, partyItemSeqNext, stronghold } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { getItem } from "./commands";
import { holderItems } from "./rows";

export type HolderEnd = Extract<ItemEnd, { kind: "party" | "stores" }>;

export const holderOf = (r: Pick<PartyItemRecord, "strongholdId">): HolderEnd =>
  r.strongholdId === undefined
    ? { kind: "party" }
    : { kind: "stores", strongholdId: r.strongholdId };

const strongholdOf = (end: HolderEnd) => (end.kind === "stores" ? end.strongholdId : null);

/** FR-LOOT-32 copy for a new row: its stronghold is DM-only now. */
function storesHiddenNow(env: CommandEnv, end: HolderEnd): boolean {
  if (end.kind !== "stores") return false;
  const row = env.tx
    .select({ dmOnly: stronghold.dmOnly })
    .from(stronghold)
    .where(eq(stronghold.id, end.strongholdId))
    .get();
  return row?.dmOnly === true;
}

/**
 * Target side: merge into the holder's row with the same key (and DM-only flag) or insert; caps
 * → `conflict` naming the side ("Party inventory is full (60)", "Stores are full (60)", qty).
 */
export function putToHolder(
  env: CommandEnv,
  cid: string,
  end: HolderEnd,
  item: { name: string; notes: string; qty: number },
  dmOnly = false,
): { change: RecordChange; after: PartyItemRecord } {
  const rows = holderItems(env.tx, cid, strongholdOf(end));
  const plan = planHolderMerge(rows, item, rowCapOf(end), dmOnly);
  if (plan.kind === "conflict")
    throw conflict(
      mergeConflictMessage(plan.reason, end, end.kind === "party" ? "Party" : "Stores"),
    );
  const now = env.ctx.clock.iso();
  if (plan.kind === "merge") {
    env.tx
      .update(partyItem)
      .set({ qty: plan.qty, updatedAt: now })
      .where(eq(partyItem.id, plan.row.id))
      .run();
    const after = getItem(env, cid, plan.row.id);
    return {
      change: { type: PARTY_ITEM_TYPE, id: plan.row.id, before: plan.row, after },
      after,
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
      strongholdId: strongholdOf(end),
      storesHidden: storesHiddenNow(env, end),
      dmOnly: end.kind === "stores" && dmOnly,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const after = getItem(env, cid, id);
  return { change: { type: PARTY_ITEM_TYPE, id, before: null, after }, after };
}

/** Source side: the row reduced by `qty` (deleted at 0), or "Only ‹n› left"; its change. */
export function takeFromHolder(env: CommandEnv, row: PartyItemRecord, qty: number): RecordChange {
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
