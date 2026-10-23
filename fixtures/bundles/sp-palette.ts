import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 9 SP1 `sp-palette` (play-shell §13 sprint 9, walkthrough P1–P11): `session-sim-12` under
 * its own name for the palette walkthrough until SP2 / SP3's `sp-s9` lands (that bundle adds the
 * rules cards P4 needs). No new unit: the palette and shortcuts add no record. The sim-12 ambush is
 * started, so turn commands are live.
 */
export default defineBundle({
  name: "sp-palette",
  includes: ["session-sim-12"],
  fixtures: [],
});
