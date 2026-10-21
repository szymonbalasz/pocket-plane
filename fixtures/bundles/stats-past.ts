import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * STATS §13 helper: `base` + `st-past-crypt` (the ended "Old Crypt"). Included **first** by
 * `stats` and `session-sim-11`: a campaign has one started fight at a time, so the past fight
 * must end before session-sim-10's Goblin Ambush starts.
 */
export default defineBundle({
  name: "stats-past",
  includes: ["base"],
  fixtures: ["st-past-crypt"],
});
