import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * DICE FR-DICE-99–110: `gems` under its own name for `e2e/dice-log-menu.e2e.ts` (a player's d20
 * line with Inspiration to spend); the e2e hides, reveals and rerolls lines, so it changes state.
 */
export default defineBundle({
  name: "dice-log-menu-e2e",
  includes: ["gems"],
  fixtures: [],
});
