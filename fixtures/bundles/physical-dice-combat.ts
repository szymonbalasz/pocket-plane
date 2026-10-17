import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * `rule-triggers` unchanged, under its own name so `e2e/physical-dice-combat.e2e.ts` (BL-19,
 * BL-25) gets its own e2e server: it moves to Brakka's turn, turns Rage on and spends Divine
 * Fury, which the `rule-triggers` specs expect untouched.
 */
export default defineBundle({
  name: "physical-dice-combat",
  includes: ["rule-triggers"],
  fixtures: [],
});
