import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Kit-parity §13 K3 `kit-notices` (walkthrough + e2e `kit-notices`): `theme-gilt` (round 3,
 * 6 combatants) + Mira's crossbow card applied on Goblin 2 (`kit-notices-applied`: the player
 * card view) + Player 1's draft "Bram" and Mira's pending crossbow card (`kit-notices`: the DM
 * stack's request card and damage card). Existing record types only.
 */
export default defineBundle({
  name: "kit-notices",
  includes: ["theme-gilt"],
  fixtures: ["kit-notices-applied", "kit-notices"],
});
