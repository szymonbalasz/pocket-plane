// Record type `asset` (FR-ASSET-10, ASSET §9): scope campaign; DM full, players never.
import { AssetRecord } from "@shared/assets-pipeline/schemas";
import { asc, eq } from "drizzle-orm";
import { asset } from "../../db/schema";
import { defineRecordType } from "../../ws/records";
import { toAssetRecord } from "./commands";

export const assetRecordType = defineRecordType<AssetRecord>({
  type: "asset",
  scope: "campaign",
  // Players: hidden, and not even an empty snapshot list (FR-ASSET-10, FR-ASSET-12).
  audience: "dm",
  schema: AssetRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: () => "hidden",
  // All of the campaign's assets; array order not significant (picker sorts).
  snapshot: ({ db }, v) =>
    db
      .select()
      .from(asset)
      .where(eq(asset.campaignId, v.campaignId))
      .orderBy(asc(asset.seq))
      .all()
      .map(toAssetRecord),
});
