import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** STATS §13 `stats-e2e`: `stats` under its own name for the stats e2e (it changes state). */
export default defineBundle({
  name: "stats-e2e",
  includes: ["stats"],
  fixtures: [],
});
