import { pauseCampaign } from "@server/features/campaign-management/pause";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { IMG } from "../scenes-map/town";

/**
 * Sprint 8 (dice-extras §13, FR-CAMP-47): the table is paused: "Pizza break, back soon", the
 * `town` image, back in 10 min (from the fixture clock, so the card may read "Back soon"). Not in
 * session-sim-12 (the sim pauses live, seams S15).
 */
export default defineFixture({
  key: "camp-paused",
  kind: "setup",
  requires: ["campaign", "images"],
  ownerSpec: "campaign-management",
  steps: [
    step(pauseCampaign, (r) => ({
      message: "Pizza break, back soon",
      imageAssetId: r.id("images", "asset", IMG.town),
      backInMin: 10 as const,
    })),
  ],
});
