import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * STATS §13.1 e2e alias for SB1 + SB2 (`e2e/stats-ui-b.e2e.ts`): `stats-b` under its own name (the
 * spec applies, ends the Ambush and changes state, so it doesn't share `stats-b-e2e`'s server).
 */
export default defineBundle({
  name: "stats-b-ui-e2e",
  includes: ["stats-b"],
  fixtures: [],
});
