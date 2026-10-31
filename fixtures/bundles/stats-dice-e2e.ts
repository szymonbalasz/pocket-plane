import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * FR-STATS-90 e2e alias (`e2e/stats-dice-chart.e2e.ts`): `stats-b` under its own name (the spec
 * rolls on its own server).
 */
export default defineBundle({
  name: "stats-dice-e2e",
  includes: ["stats-b"],
  fixtures: [],
});
