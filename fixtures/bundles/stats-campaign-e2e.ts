import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * STATS §13.4 e2e alias for T3 (`e2e/t3-campaign.e2e.ts`): `stats-b` under its own name (the spec
 * applies damage on its own server). Expected Campaign numbers: `stats.fixtures.test.ts` header.
 */
export default defineBundle({
  name: "stats-campaign-e2e",
  includes: ["stats-b"],
  fixtures: [],
});
