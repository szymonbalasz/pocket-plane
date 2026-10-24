import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 10 H3 (BL-101): e2e alias for `e2e/h3-toasts.e2e.ts` = `session-sim-13` (sim-12's
 * pending cards make the DM's "N pending actions" stack; the Rules quick reference). The spec
 * moves and opens windows (window memory stores them), so it never shares a server.
 */
export default defineBundle({
  name: "h3-toasts-e2e",
  includes: ["session-sim-13"],
  fixtures: [],
});
