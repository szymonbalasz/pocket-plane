import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** STATS §13 (ST2): `stats` under its own name for the Stats window e2e (it changes state). */
export default defineBundle({
  name: "stats-window-e2e",
  includes: ["stats"],
  fixtures: [],
});
