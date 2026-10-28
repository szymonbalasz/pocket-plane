import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 14 F2 (BL-130–132, BL-137): e2e alias for `e2e/s14-toasts.e2e.ts` = `session-sim-13` (a
 * started fight and sim-12's pending cards). The spec adds cards and steps turns, so it never
 * shares a server.
 */
export default defineBundle({
  name: "s14-toasts-e2e",
  includes: ["session-sim-13"],
  fixtures: [],
});
