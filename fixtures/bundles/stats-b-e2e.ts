import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** STATS §13.1 `stats-b-e2e`: `stats-b` under its own name for the tier-B e2e (it changes state). */
export default defineBundle({
  name: "stats-b-e2e",
  includes: ["stats-b"],
  fixtures: [],
});
