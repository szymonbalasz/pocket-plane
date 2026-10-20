// Domain events of assets-pipeline (ASSET §9, protocol §16).
import { z } from "zod";
import { defineEvent } from "./types";

const Tags = z.array(z.string());

/**
 * `assets.ingest` with outcome `created` only; `existing` emits nothing (FR-ASSET-03) unless it
 * lists an attachment (`AssetListed`, FR-ASSET-26) or adds tags (`AssetTagsSet`, FR-ASSET-41).
 * *(S5)* `listed` false = an attachment: the event is logged with no record change (FR-ASSET-24).
 * *(S6)* `tags`: the new row's tags (`[]` when none were sent, FR-ASSET-41).
 */
export const AssetIngested = defineEvent({
  type: "AssetIngested",
  payload: z
    .object({
      assetId: z.string(),
      hash: z.string(),
      bytes: z.number().int().nonnegative(),
      listed: z.boolean(),
      tags: Tags,
    })
    .strict(),
  logged: true,
  undoable: false,
});

/** FR-ASSET-26 (S5): an attachment re-uploaded with `listed: true` joins the library (DM upsert). */
export const AssetListed = defineEvent({
  type: "AssetListed",
  payload: z.object({ assetId: z.string() }).strict(),
  logged: true,
  undoable: false,
});

/**
 * *(S6)* FR-ASSET-42 `assets.setTags`, and FR-ASSET-41's re-upload adding tags: the asset's tags
 * now. `asset` upsert (DM) if listed; an attachment's has no change.
 */
export const AssetTagsSet = defineEvent({
  type: "AssetTagsSet",
  payload: z.object({ assetId: z.string(), tags: Tags }).strict(),
  logged: true,
  undoable: false,
});

/** *(S6)* FR-ASSET-43 `assets.renameTag` (a rename into an existing tag merges). */
export const AssetTagRenamed = defineEvent({
  type: "AssetTagRenamed",
  payload: z.object({ from: z.string(), to: z.string(), assetIds: z.array(z.string()) }).strict(),
  logged: true,
  undoable: false,
});

/** *(S6)* FR-ASSET-43 `assets.deleteTag`: removed from every asset of the campaign. */
export const AssetTagDeleted = defineEvent({
  type: "AssetTagDeleted",
  payload: z.object({ tag: z.string(), assetIds: z.array(z.string()) }).strict(),
  logged: true,
  undoable: false,
});
