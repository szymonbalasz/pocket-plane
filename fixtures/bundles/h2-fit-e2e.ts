import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 10 H2 `h2-fit-e2e`: `session-sim-12` under its own name for the Fit with a remembered
 * window over the map centre (`e2e/h2-fit.e2e.ts`: shows Goblin Ambush). No new unit.
 */
export default defineBundle({ name: "h2-fit-e2e", includes: ["session-sim-12"], fixtures: [] });
