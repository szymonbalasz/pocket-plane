// Rows → registry records (PARTY §8, §9). `handout` and `handout-body` read one table; the header
// provider never reads `body`. Nothing here writes.
import type {
  HandoutBodyRecord,
  HandoutRecord,
  PartyItemRecord,
} from "@shared/party-board/schemas";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { handout, partyItem, player } from "../../db/schema";

type Reader = Pick<Db | Tx, "select">;
type HandoutRow = typeof handout.$inferSelect;
type ItemRow = typeof partyItem.$inferSelect;

const headerColumns = {
  id: handout.id,
  campaignId: handout.campaignId,
  seq: handout.seq,
  title: handout.title,
  imageAssetIds: handout.imageAssetIds,
  sharedWith: handout.sharedWith,
  rev: handout.rev,
  createdAt: handout.createdAt,
  updatedAt: handout.updatedAt,
  sharedAt: handout.sharedAt,
};

/** FR-PARTY-01 header: every field but `body` / `bodyRev`. */
export function toHandoutRecord(r: Omit<HandoutRow, "body" | "bodyRev">): HandoutRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    seq: r.seq,
    title: r.title,
    imageAssetIds: r.imageAssetIds,
    sharedWith: r.sharedWith,
    rev: r.rev,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    sharedAt: r.sharedAt,
  };
}

/** FR-PARTY-01 body: `{id = handoutId, campaignId, body, rev, sharedWith}`; `rev` = `bodyRev`. */
export function toHandoutBodyRecord(
  r: Pick<HandoutRow, "id" | "campaignId" | "body" | "bodyRev" | "sharedWith">,
): HandoutBodyRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    body: r.body,
    rev: r.bodyRev,
    sharedWith: r.sharedWith,
  };
}

export function toPartyItemRecord(r: ItemRow): PartyItemRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    seq: r.seq,
    name: r.name,
    qty: r.qty,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function getHandoutRow(db: Reader, campaignId: string, id: string): HandoutRow | null {
  return (
    db
      .select()
      .from(handout)
      .where(and(eq(handout.id, id), eq(handout.campaignId, campaignId)))
      .get() ?? null
  );
}

/** Every handout header of the campaign, `seq` order (no body read). */
export function listHandouts(db: Reader, campaignId: string): HandoutRecord[] {
  return db
    .select(headerColumns)
    .from(handout)
    .where(eq(handout.campaignId, campaignId))
    .orderBy(asc(handout.seq))
    .all()
    .map(toHandoutRecord);
}

/** `sync.load {type: handout-body, ids}`: the rows among `ids` (the scope gate filters campaigns). */
export function handoutBodiesByIds(db: Reader, ids: readonly string[]): HandoutBodyRecord[] {
  if (ids.length === 0) return [];
  return db
    .select({
      id: handout.id,
      campaignId: handout.campaignId,
      body: handout.body,
      bodyRev: handout.bodyRev,
      sharedWith: handout.sharedWith,
    })
    .from(handout)
    .where(inArray(handout.id, [...ids]))
    .orderBy(asc(handout.seq))
    .all()
    .map(toHandoutBodyRecord);
}

export function handoutCount(db: Reader, campaignId: string): number {
  return (
    db.select({ n: count() }).from(handout).where(eq(handout.campaignId, campaignId)).get()?.n ?? 0
  );
}

/** Every party item of the campaign, `seq` order. */
export function listPartyItems(db: Reader, campaignId: string): PartyItemRecord[] {
  return db
    .select()
    .from(partyItem)
    .where(eq(partyItem.campaignId, campaignId))
    .orderBy(asc(partyItem.seq))
    .all()
    .map(toPartyItemRecord);
}

/** Player ids of the campaign at commit, creation order (FR-PARTY-06 gainers). */
export function campaignPlayerIds(db: Reader, campaignId: string): string[] {
  return db
    .select({ id: player.id })
    .from(player)
    .where(eq(player.campaignId, campaignId))
    .orderBy(asc(player.createdAt), asc(player.id))
    .all()
    .map((p) => p.id);
}
