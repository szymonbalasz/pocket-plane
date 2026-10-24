import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 11 F1 `f1-fit-e2e`: `session-sim-13` under its own name for the Fit with the untouched
 * Party Manager open and the DM launcher's labels at 1440×900 (`e2e/f1-fit.e2e.ts`: shows Goblin
 * Ambush). No new unit.
 */
export default defineBundle({ name: "f1-fit-e2e", includes: ["session-sim-13"], fixtures: [] });
