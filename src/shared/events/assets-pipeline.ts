// Domain events of assets-pipeline (ASSET §9, protocol §16).
import { z } from "zod";
import { defineEvent } from "./types";

/** `assets.ingest` with outcome `created` only; `existing` emits nothing (FR-ASSET-03). */
export const AssetIngested = defineEvent({
  type: "AssetIngested",
  payload: z
    .object({ assetId: z.string(), hash: z.string(), bytes: z.number().int().nonnegative() })
    .strict(),
  logged: true,
  undoable: false,
});
