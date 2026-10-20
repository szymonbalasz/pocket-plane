import { setFeature } from "@server/features/campaign-management/features";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { GEMS_FEATURE } from "@shared/campaign-management/features";

/** GEM §13: the DM switches gems on (`camp.setFeature`, FR-CAMP-39). Creates no ids or tokens. */
export default defineFixture({
  key: "gems-on",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "gems",
  steps: [step(setFeature, { feature: GEMS_FEATURE, on: true })],
});
