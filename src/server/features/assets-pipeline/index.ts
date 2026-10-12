import type { Feature } from "../../services";
import { ingestCommand } from "./commands";
import { assetRecordType } from "./records";
import { AssetStore, bindAssetStore } from "./store";

export const assetsPipeline: Feature = {
  name: "assets-pipeline",
  register(r) {
    const s = r.services;
    const store = new AssetStore(s.config.assetDir, s.log);
    bindAssetStore(s, store);
    // REST upload + fixture loader only; no WS intents (ASSET §9).
    r.command(ingestCommand(store));
    r.recordType(assetRecordType);
    // FR-ASSET-07: crash recovery on server start (never in the loader's preflight).
    r.onStart("asset-store-sweep", () => {
      store.sweep(s.db);
    });
  },
};
