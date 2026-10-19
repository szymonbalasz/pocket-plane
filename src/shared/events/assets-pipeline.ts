// Domain events of assets-pipeline (ASSET §9, protocol §16).
import { z } from "zod";
import { defineEvent } from "./types";

/**
 * `assets.ingest` with outcome `created` only; `existing` emits nothing (FR-ASSET-03) unless it
 * lists an attachment (`AssetListed`, FR-ASSET-26). *(S5)* `listed` false = an attachment: the
 * event is logged with no record change (FR-ASSET-24).
 */
export const AssetIngested = defineEvent({
  type: "AssetIngested",
  payload: z
    .object({
      assetId: z.string(),
      hash: z.string(),
      bytes: z.number().int().nonnegative(),
      listed: z.boolean(),
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
