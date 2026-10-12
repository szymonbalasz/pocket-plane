import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { activateCampaign } from "@server/features/campaign-management/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Second Campaign gets `town.svg` as "Town (copy)": same file set, its own asset ID
 * (FR-ASSET-04, FR-ASSET-09). Fixture Campaign is active again afterwards.
 */
export default defineFixture({
  key: "images-second",
  kind: "setup",
  requires: ["campaign-second", "images"],
  ownerSpec: "assets-pipeline",
  assets: ["maps/town.svg"],
  steps: [
    step(activateCampaign, (r) => ({ id: r.id("campaign-second", "campaign") })),
    ingestStep("maps/town.svg", "Town (copy)"),
    step(activateCampaign, (r) => ({ id: r.id("campaign", "campaign") })),
  ],
});
