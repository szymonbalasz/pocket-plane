// Row ↔ record mapping and lookups for overview scenes. Kept free of command imports: the
// scenes-map registries load `lifecycle.ts`, which reads through here.
import {
  OVERVIEW_ITEM_TYPE,
  OVERVIEW_TYPE,
  type OverviewItemRecord,
  type OverviewRecord,
} from "@shared/overview-scenes/schemas";
import { and, asc, count, eq } from "drizzle-orm";
import { notFound } from "../../commands/errors";
import type { Db, Tx } from "../../db/client";
import { overview, overviewItem } from "../../db/schema";
import type { RecordChange } from "../../events/types";

type OverviewRow = typeof overview.$inferSelect;
type ItemRow = typeof overviewItem.$inferSelect;
type Read = Pick<Tx, "select">;

export const toOverviewRecord = (r: OverviewRow): OverviewRecord => ({ ...r });
export const toItemRecord = (r: ItemRow): OverviewItemRecord => ({ ...r });

export const overviewChange = (
  before: OverviewRecord | null,
  after: OverviewRecord | null,
): RecordChange => ({
  type: OVERVIEW_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

export const itemChange = (
  before: OverviewItemRecord | null,
  after: OverviewItemRecord | null,
): RecordChange => ({
  type: OVERVIEW_ITEM_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

/** An overview of the campaign, else `not_found` (other campaigns look unknown). */
export function getOverview(tx: Read, cid: string, id: string): OverviewRecord {
  const r = tx
    .select()
    .from(overview)
    .where(and(eq(overview.id, id), eq(overview.campaignId, cid)))
    .get();
  if (!r) throw notFound("Overview not found");
  return toOverviewRecord(r);
}

export function readOverview(tx: Read, id: string): OverviewRecord {
  return toOverviewRecord(
    tx.select().from(overview).where(eq(overview.id, id)).get() as OverviewRow,
  );
}

export function readItem(tx: Read, id: string): OverviewItemRecord {
  return toItemRecord(
    tx.select().from(overviewItem).where(eq(overviewItem.id, id)).get() as ItemRow,
  );
}

/** The campaign's shown overview, or null (FR-OVW-05). */
export function shownOverviewOf(tx: Read, cid: string): OverviewRecord | null {
  const r = tx
    .select()
    .from(overview)
    .where(and(eq(overview.campaignId, cid), eq(overview.active, true)))
    .get();
  return r ? toOverviewRecord(r) : null;
}

/** An overview's items in `seq` order. */
export function itemsOf(tx: Read, overviewId: string): OverviewItemRecord[] {
  return tx
    .select()
    .from(overviewItem)
    .where(eq(overviewItem.overviewId, overviewId))
    .orderBy(asc(overviewItem.seq))
    .all()
    .map(toItemRecord);
}

export const countOverviews = (tx: Read, cid: string): number =>
  tx.select({ n: count() }).from(overview).where(eq(overview.campaignId, cid)).get()?.n ?? 0;

export function countItems(
  tx: Read,
  where: { overviewId: string } | { campaignId: string },
): number {
  const cond =
    "overviewId" in where
      ? eq(overviewItem.overviewId, where.overviewId)
      : eq(overviewItem.campaignId, where.campaignId);
  return tx.select({ n: count() }).from(overviewItem).where(cond).get()?.n ?? 0;
}

/** Providers: every overview / item of the campaign; the scene gate and the window cut them. */
export const campaignOverviews = (db: Db, cid: string): OverviewRecord[] =>
  db
    .select()
    .from(overview)
    .where(eq(overview.campaignId, cid))
    .orderBy(asc(overview.seq))
    .all()
    .map(toOverviewRecord);

export const campaignItems = (
  db: Db,
  cid: string,
  scope?: { sceneId: string },
): OverviewItemRecord[] =>
  db
    .select()
    .from(overviewItem)
    .where(
      scope
        ? and(eq(overviewItem.campaignId, cid), eq(overviewItem.overviewId, scope.sceneId))
        : eq(overviewItem.campaignId, cid),
    )
    .orderBy(asc(overviewItem.seq))
    .all()
    .map(toItemRecord);
