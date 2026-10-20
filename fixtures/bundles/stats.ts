import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * STATS §13 `stats` (ST core): the past "Old Crypt" (`stats-past`, loaded first) +
 * `session-sim-10` (Goblin Ambush running) + `st-ambush-facts`. One past session (fixed clock):
 * live play makes "Today". Gems off.
 */
export default defineBundle({
  name: "stats",
  includes: ["stats-past", "session-sim-10"],
  fixtures: ["st-ambush-facts"],
});
