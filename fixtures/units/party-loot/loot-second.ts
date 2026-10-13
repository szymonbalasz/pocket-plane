import { activateCampaign } from "@server/features/campaign-management/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { lootAdd } from "@server/features/party-loot/commands";

/** Marker the scope leak scans look for (LOOT §13). */
export const SECOND_LOOT_TEXT = "SECOND-CAMPAIGN-LOOT";

/** LOOT §13: one entry (1 gp) in the Second Campaign, then the Fixture Campaign is active again. */
export default defineFixture({
  key: "loot-second",
  kind: "setup",
  requires: ["campaign-second"],
  ownerSpec: "party-loot",
  steps: [
    step(activateCampaign, (r) => ({ id: r.id("campaign-second", "campaign") })),
    step(lootAdd, { text: SECOND_LOOT_TEXT, gp: 1 }),
    step(activateCampaign, (r) => ({ id: r.id("campaign", "campaign") })),
  ],
});
