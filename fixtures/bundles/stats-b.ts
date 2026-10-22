import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * STATS §13.1 `stats-b` (SB core): `stats` (the past "Old Crypt" + session-sim-10's Goblin Ambush
 * + `st-ambush-facts`) + `gems-on` + the tier-B units: `sb-fight-facts` (Bandits), `sb-luck-rolls`
 * and `sb-luck-reroll` (gems on). Fixed clock: one past session; live play makes "Today".
 */
export default defineBundle({
  name: "stats-b",
  includes: ["stats"],
  fixtures: ["gems-on", "sb-fight-facts", "sb-luck-rolls", "sb-luck-reroll"],
});
