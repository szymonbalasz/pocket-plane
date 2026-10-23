import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 9 PM `pm-memory-e2e`: `session-sim-12` under its own name for the state-changing e2e
 * (`e2e/window-memory.e2e.ts`: Start / End, Reset layout). No new unit.
 */
export default defineBundle({
  name: "pm-memory-e2e",
  includes: ["session-sim-12"],
  fixtures: [],
});
