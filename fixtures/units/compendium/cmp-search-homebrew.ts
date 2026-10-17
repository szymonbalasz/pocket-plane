import { putEntry } from "@server/features/compendium/homebrew";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/** Marker the S4 leak scans look for (CMP §13): the DM-only homebrew Potion of Healing's text. */
export const HB_POTION_MARKER = "CMP-HB-POTION";

/**
 * CMP §13 `cmp-search-homebrew` (S4): Fixture Campaign homebrew for the ranking table: item
 * "Potion of Healing" (**DM only**, same name as the SRD item, own words), item "Healing
 * Draught" (shared, text "a potion that heals 2d4 + 2").
 */
export default defineFixture({
  key: "cmp-search-homebrew",
  kind: "setup",
  requires: ["campaign", "cmp-srd-mini"],
  ownerSpec: "compendium",
  steps: [
    step(putEntry, {
      entry: {
        kind: "item",
        name: "Potion of Healing",
        facets: { category: "magic", rarity: "common", attunement: false },
        body: {
          typeLine: "Potion",
          text: `${HB_POTION_MARKER}: the DM's own brew. Red and fizzy; drink it to regain 2d4 + 2 hit points.`,
        },
      },
    }),
    step(putEntry, {
      shared: true,
      entry: {
        kind: "item",
        name: "Healing Draught",
        facets: { category: "magic", rarity: "common", attunement: false },
        body: { typeLine: "Wondrous item", text: "A potion that heals 2d4 + 2." },
      },
    }),
  ],
});
