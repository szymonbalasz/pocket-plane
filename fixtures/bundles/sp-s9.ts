import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * PLAY-SHELL §13 / RECAP §13 `sp-s9` (shared by every SP walkthrough): `session-sim-12` + the SP
 * units. Each SP slice appends its own (keep every line on a merge): SP2's `cmp-rules-mini` +
 * `cmp-rule-house` (compendium §13.3), SP3's `recap-loot-haul`. The sim-12 ambush is started, so
 * turn commands are live.
 */
export default defineBundle({
  name: "sp-s9",
  includes: ["session-sim-12"],
  fixtures: [
    // SP2 (build/sp-rules): the rules cards and two house rules (compendium §13.3)
    "cmp-rules-mini",
    "cmp-rule-house",
    // SP3 (build/sp-recap): the session's loot haul
    "recap-loot-haul",
  ],
});
