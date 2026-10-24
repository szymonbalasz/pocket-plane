import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 10 T2 E2E alias of `companions` (`e2e/t2-pet-hidden.e2e.ts`, BL-114: it hides and shows
 * Mira's Owlbear in the running ambush, so it changes state). No new unit.
 */
export default defineBundle({
  name: "t2-pet-hidden-e2e",
  includes: ["companions"],
  fixtures: [],
});
