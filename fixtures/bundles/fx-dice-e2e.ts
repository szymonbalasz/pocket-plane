import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * DICE §13 FX2 (sprint 9): e2e alias for `e2e/fx-dice.e2e.ts` = `gems-reroll-e2e` (gems on, Mira's
 * lines to reroll); the spec rolls and rerolls, so it changes state (never shares a server).
 */
export default defineBundle({
  name: "fx-dice-e2e",
  includes: ["gems-reroll-e2e"],
  fixtures: [],
});
