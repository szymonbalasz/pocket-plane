import { realContext } from "../../commands/context";
import type { Feature } from "../../services";
import { backfillAssetTags } from "./backfill";
import { ingestCommand } from "./commands";
import { assetUsesQuery, deleteAsset, renameAsset } from "./manage";
import { assetRecordType, audioAssetRecordType } from "./records";
import { AssetStore, bindAssetStore } from "./store";
import { deleteTag, renameTag, setTags } from "./tags";

export const assetsPipeline: Feature = {
  name: "assets-pipeline",
  register(r) {
    const s = r.services;
    const store = new AssetStore(s.config.assetDir, s.log);
    bindAssetStore(s, store);
    // Uploads: REST + fixture loader (ASSET §9). *(S6)* DM-only tag intents (FR-ASSET-42, -43).
    r.command(ingestCommand(store));
    r.command(setTags, { intent: true });
    r.command(renameTag, { intent: true });
    r.command(deleteTag, { intent: true });
    // #386: DM-only rename / delete an image (FR-ASSET-62–64).
    r.command(renameAsset, { intent: true });
    r.command(deleteAsset, { intent: true });
    r.command(assetUsesQuery, { intent: true }); // #394: the Assets window's "Used in" (FR-ASSET-68)
    r.recordType(assetRecordType);
    // *(Sprint 8, TT0)* sounds: lazy DM-only type (FR-ASSET-57); probe, upload and serve are TT3.
    r.recordType(audioAssetRecordType);
    // FR-ASSET-07: crash recovery on server start (never in the loader's preflight).
    r.onStart("asset-store-sweep", () => {
      store.sweep(s.db);
    });
    // FR-ASSET-49: pre-IM-1 rows get guessed tags, once per DB.
    r.onStart("assets-pipeline.tags-backfill", (sv) => {
      const n = backfillAssetTags(sv.db, realContext(sv.clock));
      if (n > 0) sv.log.info(`assets: guessed tags for ${n} image(s) (FR-ASSET-49)`);
    });
  },
};
