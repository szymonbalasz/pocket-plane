import {
  activateCampaign,
  addPlayer,
  createCampaign,
} from "@server/features/campaign-management/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/** "Second Campaign", inactive, with "Second Player" (CAMP §13). */
export default defineFixture({
  key: "campaign-second",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "campaign-management",
  steps: [
    step(createCampaign, { name: "Second Campaign" }),
    step(activateCampaign, (r) => ({ id: r.id("campaign-second", "campaign") })),
    step(addPlayer, { name: "Second Player" }),
    step(activateCampaign, (r) => ({ id: r.id("campaign", "campaign") })),
  ],
});
