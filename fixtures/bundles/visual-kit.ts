import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Screenshot baselines (#368, e2e `visual`): `kit-round3-combat`'s world (every kit section, the
 * round-3 fight, companion groups) in its own server, so no other spec's edits reach the
 * baselines. Existing units only; no new record type.
 */
export default defineBundle({
  name: "visual-kit",
  includes: ["kit-round3-combat"],
  fixtures: [],
});
