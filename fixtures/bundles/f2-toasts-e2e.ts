import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 11 F2 (BL-108): e2e alias for `e2e/f2-toasts.e2e.ts` = `session-sim-13` (sim-12's
 * pending cards make the DM's "N pending actions" stack and Initiative's pending damage cards).
 * The spec moves windows and sends roll requests, so it never shares a server.
 */
export default defineBundle({
  name: "f2-toasts-e2e",
  includes: ["session-sim-13"],
  fixtures: [],
});
