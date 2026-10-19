import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { putEntry } from "@server/features/compendium/homebrew";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";

const FILES = ["items/lantern.svg", "items/lantern-lit.svg", "items/relic.svg"] as const;

/** Names, asset order (`r.id("cmp-images", "asset", i)`) and leak markers (CMP §13.1). */
export const CMP_IMAGES = {
  key: "cmp-images",
  lantern: "Moonlit Lantern",
  secret: "CMP-IMG-SECRET",
  asset: { lantern: 0, lanternLit: 1, relic: 2 },
} as const;

/** This fixture's attachment ids, by ingest index. */
const images = (r: Refs, ...at: number[]) => at.map((i) => r.id(CMP_IMAGES.key, "asset", i));

/**
 * CMP §13.1 `cmp-images`: ingests `lantern`, `lantern-lit` and `relic` (256 × 256) as
 * **attachments** (`listed: false`, FR-ASSET-24; no record, no snapshot bytes), then Fixture
 * Campaign homebrew: item "Moonlit Lantern" (shared, images `[lantern, lantern-lit]`) and item
 * "CMP-IMG-SECRET" (DM only, images `[relic]`). `cmp-homebrew`'s entries and the SRD mini stay
 * untouched (imported entries have no images).
 */
export default defineFixture({
  key: CMP_IMAGES.key,
  kind: "setup",
  requires: ["cmp-homebrew"],
  ownerSpec: "compendium",
  assets: FILES,
  steps: [
    ...FILES.map((f) => ingestStep(f, { listed: false })),
    step(putEntry, (r) => ({
      shared: true,
      imageAssetIds: images(r, CMP_IMAGES.asset.lantern, CMP_IMAGES.asset.lanternLit),
      entry: {
        kind: "item" as const,
        name: CMP_IMAGES.lantern,
        facets: { category: "magic" as const, rarity: "uncommon" as const, attunement: false },
        body: {
          typeLine: "Wondrous item",
          weight: "2 lb.",
          text: "A hooded lantern of blackened silver. Lit, it burns without oil and sheds moonlight: bright light in a 20-foot radius and dim light for a further 20 feet.",
        },
      },
    })),
    step(putEntry, (r) => ({
      imageAssetIds: images(r, CMP_IMAGES.asset.relic),
      entry: {
        kind: "item" as const,
        name: CMP_IMAGES.secret,
        facets: { category: "gear" as const, attunement: false },
        body: {
          typeLine: "Adventuring gear",
          text: "The DM's secret reliquary: it holds the lich's phylactery.",
        },
      },
    })),
  ],
});
