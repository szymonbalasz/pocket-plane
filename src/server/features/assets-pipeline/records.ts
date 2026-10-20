// Record type `asset` (FR-ASSET-10, ASSET §9): scope campaign; DM full, players never.
// *(S5)* Library (listed) assets only: an attachment has no record (FR-ASSET-24).
import { AssetRecord } from "@shared/assets-pipeline/schemas";
import { and, asc, eq } from "drizzle-orm";
import { asset } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { defineRecordType } from "../../ws/records";

type AssetRow = typeof asset.$inferSelect;

/**
 * The only mapping from a row to the wire: `hash` and `listed` are dropped here (ASSET §8).
 * *(S6)* A pre-IM-1 row's null `tags` is sent as `[]` (FR-ASSET-10).
 */
export const toAssetRecord = (r: AssetRow): AssetRecord => ({
  id: r.id,
  campaignId: r.campaignId,
  seq: r.seq,
  name: r.name,
  mime: r.mime,
  bytes: r.bytes,
  width: r.width,
  height: r.height,
  displayWidth: r.displayWidth,
  displayHeight: r.displayHeight,
  createdAt: r.createdAt,
  tags: r.tags ?? [],
});

/** An `asset` upsert (DM) if the row is listed; an attachment has no record (FR-ASSET-24). */
export function assetUpsert(row: AssetRow): RecordChange[] {
  return row.listed ? [{ type: "asset", id: row.id, before: null, after: toAssetRecord(row) }] : [];
}

export const assetRecordType = defineRecordType<AssetRecord>({
  type: "asset",
  scope: "campaign",
  // Players: hidden, and not even an empty snapshot list (FR-ASSET-10, FR-ASSET-12).
  audience: "dm",
  schema: AssetRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: () => "hidden",
  // The campaign's listed assets (S5: attachments never, FR-ASSET-24); array order not
  // significant (picker sorts).
  snapshot: ({ db }, v) =>
    db
      .select()
      .from(asset)
      .where(and(eq(asset.campaignId, v.campaignId), eq(asset.listed, true)))
      .orderBy(asc(asset.seq))
      .all()
      .map(toAssetRecord),
});
