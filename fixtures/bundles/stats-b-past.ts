import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * STATS §13.1 helper (gate ruling): `stats-past` + `sb-past-bandits` (the ended "Bandit Camp").
 * Included **first** by session-sim-12: a campaign has one started fight at a time, so the past
 * fight must end before session-sim-10's Goblin Ambush starts.
 */
export default defineBundle({
  name: "stats-b-past",
  includes: ["stats-past"],
  fixtures: ["sb-past-bandits"],
});
