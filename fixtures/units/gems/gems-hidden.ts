import { setFeature } from "@server/features/campaign-management/features";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { GEMS_FEATURE } from "@shared/campaign-management/features";

/**
 * GEM §13 `gems-hidden`: gems off again after `gems-awarded`: counts and lines are kept in the DB
 * and reach nobody (FR-GEM-04, OQ-GEM-04 A).
 */
export default defineFixture({
  key: "gems-hidden",
  kind: "setup",
  requires: ["gems-awarded"],
  ownerSpec: "gems",
  steps: [step(setFeature, { feature: GEMS_FEATURE, on: false })],
});
