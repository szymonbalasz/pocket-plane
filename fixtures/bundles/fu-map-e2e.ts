import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 7 FU3 `fu-map-e2e`: `session-sim-10` under its own name for `e2e/map-followups.e2e.ts`
 * (the e2e shows Goblin Ambush and reveals its fog, so it changes state; seams S12 rule). FU3 adds
 * no unit: the map follow-ups walk on session-sim-10's Goblin Ambush.
 */
export default defineBundle({
  name: "fu-map-e2e",
  includes: ["session-sim-10"],
  fixtures: [],
});
