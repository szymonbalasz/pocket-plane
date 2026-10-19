// Record type `asset` (FR-ASSET-10, ASSET §9): scope campaign; DM full, players never.
// *(S5)* Library (listed) assets only: an attachment has no record (FR-ASSET-24).
import { AssetRecord } from "@shared/assets-pipeline/schemas";
import { and, asc, eq } from "drizzle-orm";
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
