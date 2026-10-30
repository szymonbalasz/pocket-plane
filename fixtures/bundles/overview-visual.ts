import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Screenshot baselines (OVW §13, e2e `visual-overview`): `overview-scenes`'s world in its own server,
 * so no other spec's edits reach the baselines.
 */
export default defineBundle({
  name: "overview-visual",
  includes: ["overview-scenes"],
  fixtures: [],
});
