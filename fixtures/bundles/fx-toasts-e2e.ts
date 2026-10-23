import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * NOTE §13 FX1 (sprint 9): e2e alias for `e2e/fx-toasts.e2e.ts` = `session-sim-12` (its pending
 * cards make the DM's "N pending actions" stack); the spec moves and opens windows (window memory
 * stores them), so it never shares a server.
 */
export default defineBundle({
  name: "fx-toasts-e2e",
  includes: ["session-sim-12"],
  fixtures: [],
});
