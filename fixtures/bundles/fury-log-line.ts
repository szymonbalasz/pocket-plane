import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * `session-sim-7` unchanged, under its own name so `e2e/fury-log-line.e2e.ts` gets its own e2e
 * server: it leaves Brakka's turn, Rage on and Divine Fury used, which `trigger-state.e2e.ts`
 * (on `session-sim-7`) expects untouched.
 */
export default defineBundle({
  name: "fury-log-line",
  includes: ["session-sim-7"],
  fixtures: [],
});
