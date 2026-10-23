import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 9 SP1 `sp-palette-e2e`: `session-sim-12` under its own name for the thin palette e2e
 * (`e2e/sp-palette.e2e.ts`: the DM's turn keys change state). No new unit.
 */
export default defineBundle({
  name: "sp-palette-e2e",
  includes: ["session-sim-12"],
  fixtures: [],
});
