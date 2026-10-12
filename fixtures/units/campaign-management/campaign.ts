import { createCampaign } from "@server/features/campaign-management/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/** "Fixture Campaign", active (created on an empty DB → becomes active). */
export default defineFixture({
  key: "campaign",
  kind: "setup",
  requires: [],
  ownerSpec: "campaign-management",
  steps: [step(createCampaign, { name: "Fixture Campaign" })],
});
