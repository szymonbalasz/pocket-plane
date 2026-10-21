import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * GEM §13 (GM2): `gems` under its own name for `e2e/gems-combat.e2e.ts` (Brakka: level 5, Combat
 * 2, the Flame Tongue greatsword); the e2e maxes dice on two of his cards and applies one, so it
 * changes state and gets a server of its own.
 */
export default defineBundle({
  name: "gems-combat-e2e",
  includes: ["gems"],
  fixtures: [],
});
