import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * `base` + every FIX §8 fixture marked "in session-sim" that exists (FR-FIX-25).
 * Skeleton: equals `base`. Later phases append their fixture keys here.
 */
export default defineBundle({
  name: "session-sim",
  includes: ["base"],
  fixtures: ["images", "enemy-1", "enemy-2", "enemy-custom", "char-mira"],
});
