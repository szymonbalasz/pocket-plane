import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * `e2e/s15-frame.e2e.ts` (BL-174, BL-176, BL-164, BL-171): the session-sim fight, on a server of
 * its own: the spec rolls attacks. No unit: the slice is client-only.
 */
export default defineBundle({
  name: "s15-frame-e2e",
  includes: ["session-sim-13"],
  fixtures: [],
});
