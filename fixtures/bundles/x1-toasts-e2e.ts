import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 12 X1 (BL-118 / BL-119 / BL-120): e2e alias for `e2e/x1-toasts.e2e.ts` = `session-sim-13`
 * (sim-12's pending cards make the DM's "N pending actions" summary; Player 1's sheet attacks in
 * the started fight). The spec moves windows, sends roll requests and makes cards, so it never
 * shares a server.
 */
export default defineBundle({
  name: "x1-toasts-e2e",
  includes: ["session-sim-13"],
  fixtures: [],
});
