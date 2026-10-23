// Rows → registry records (PARTY §8, §9). `handout` and `handout-body` read one table; the header
// provider never reads `body`. Nothing here writes.
import type {
  HandoutBodyRecord,
  HandoutPresentRecord,
  HandoutRecord,
  PartyItemRecord,
} from "@shared/party-board/schemas";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { handout, handoutPresent, partyItem, player } from "../../db/schema";

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
    // *(S9)* FR-LOOT-36: on the wire only when set / true.
    ...(r.strongholdId === null ? {} : { strongholdId: r.strongholdId }),
    ...(r.storesHidden ? { storesHidden: true as const } : {}),
    ...(r.dmOnly ? { dmOnly: true as const } : {}),
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

/**
 * Every `party_item` row of the campaign, `seq` order: *(S9)* the party's and every Stores' (one
 * lazy load brings both, FR-LOOT-36). Holder-scoped rules use `holderItems`.
 */
export function listPartyItems(db: Reader, campaignId: string): PartyItemRecord[] {
  return db
    .select()
    .from(partyItem)
    .where(eq(partyItem.campaignId, campaignId))
    .orderBy(asc(partyItem.seq))
    .all()
    .map(toPartyItemRecord);
}

/** *(S9)* One holder's rows (`strongholdId` null = the party inventory), `seq` order. */
export function holderItems(
  db: Reader,
  campaignId: string,
  strongholdId: string | null,
): PartyItemRecord[] {
  return db
    .select()
    .from(partyItem)
    .where(
      and(
        eq(partyItem.campaignId, campaignId),
        strongholdId === null
          ? isNull(partyItem.strongholdId)
          : eq(partyItem.strongholdId, strongholdId),
      ),
    )
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

/** Players of the campaign with their names, creation order (FR-PARTY-32 messages). */
export function campaignPlayers(db: Reader, campaignId: string): { id: string; name: string }[] {
  return db
    .select({ id: player.id, name: player.name })
    .from(player)
    .where(eq(player.campaignId, campaignId))
    .orderBy(asc(player.createdAt), asc(player.id))
    .all();
}

type PresentRow = typeof handoutPresent.$inferSelect;

export function toPresentRecord(r: PresentRow): HandoutPresentRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    handoutId: r.handoutId,
    playerId: r.playerId,
    presentedAt: r.presentedAt,
  };
}

const presentOrder = [asc(handoutPresent.presentedAt), asc(handoutPresent.id)] as const;

/** FR-PARTY-31 snapshot rows: the campaign's presents (`playerId` given → only that player's). */
export function listPresents(
  db: Reader,
  campaignId: string,
  playerId?: string,
): HandoutPresentRecord[] {
  return db
    .select()
    .from(handoutPresent)
    .where(
      playerId === undefined
        ? eq(handoutPresent.campaignId, campaignId)
        : and(eq(handoutPresent.campaignId, campaignId), eq(handoutPresent.playerId, playerId)),
    )
    .orderBy(...presentOrder)
    .all()
    .map(toPresentRecord);
}

/** Every present row of one handout, `presentedAt` order. */
export function presentsOfHandout(db: Reader, handoutId: string): HandoutPresentRecord[] {
  return db
    .select()
    .from(handoutPresent)
    .where(eq(handoutPresent.handoutId, handoutId))
    .orderBy(...presentOrder)
    .all()
    .map(toPresentRecord);
}

export function getPresent(
  db: Reader,
  campaignId: string,
  id: string,
): HandoutPresentRecord | null {
  const r = db
    .select()
    .from(handoutPresent)
    .where(and(eq(handoutPresent.id, id), eq(handoutPresent.campaignId, campaignId)))
    .get();
  return r ? toPresentRecord(r) : null;
}
