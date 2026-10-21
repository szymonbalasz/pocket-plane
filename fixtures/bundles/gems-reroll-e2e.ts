import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * GEM §13 (GM1): `gems` under its own name for `e2e/gems-reroll.e2e.ts`; the e2e rerolls lines
 * and switches gems off and on, so it changes state.
 */
export default defineBundle({
  name: "gems-reroll-e2e",
  includes: ["gems"],
  fixtures: [],
});
