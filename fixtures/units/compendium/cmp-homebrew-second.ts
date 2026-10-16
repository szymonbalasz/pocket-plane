import { activateCampaign } from "@server/features/campaign-management/commands";
import { putEntry } from "@server/features/compendium/homebrew";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/** Marker the scope leak scans look for (CMP §13). */
export const SECOND_HOMEBREW_NAME = "CMP-SECOND-HOMEBREW";

/**
 * CMP §13 `cmp-homebrew-second`: in the Second Campaign a shared homebrew item; then the
 * Fixture Campaign is active again.
 */
export default defineFixture({
  key: "cmp-homebrew-second",
  kind: "setup",
  requires: ["campaign-second"],
  ownerSpec: "compendium",
  steps: [
    step(activateCampaign, (r) => ({ id: r.id("campaign-second", "campaign") })),
    step(putEntry, {
      shared: true,
      entry: {
        kind: "item",
        name: SECOND_HOMEBREW_NAME,
        facets: { category: "gear", attunement: false },
        body: { typeLine: "Adventuring gear", text: "Only the Second Campaign has this." },
      },
    }),
    step(activateCampaign, (r) => ({ id: r.id("campaign", "campaign") })),
  ],
});
