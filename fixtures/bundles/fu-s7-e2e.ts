import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 7 FU-combat `fu-s7-e2e`: `fu-s7` under its own name for `e2e/combat-followups.e2e.ts`
 * (the e2e Ends and Starts, so it changes state; seams S12 rule).
 */
export default defineBundle({
  name: "fu-s7-e2e",
  includes: ["fu-s7"],
  fixtures: [],
});
