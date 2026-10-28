import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 14 F3 (BL-138, BL-139, BL-141): e2e alias for `e2e/s14-kit.e2e.ts` = `session-sim-13`
 * (sim-12's pending cards make the DM's "N pending actions" summary; the fight and the sheets).
 * The spec opens dialogs and windows (window memory stores them), so it never shares a server.
 */
export default defineBundle({
  name: "s14-kit-e2e",
  includes: ["session-sim-13"],
  fixtures: [],
});
