import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 10 T2 E2E alias of `stats` (`e2e/t2-awards.e2e.ts`, BL-111): Mira's late 11 on the hidden
 * Goblin 2 is DM-only, so players get no "Most damage dealt" there. No new unit.
 */
export default defineBundle({
  name: "t2-awards-e2e",
  includes: ["stats"],
  fixtures: [],
});
