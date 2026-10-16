import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * MOD §13 `rule-triggers` = `effect-modifiers` + `mod-tier2` + `char-brakka` + `trg-brakka` +
 * `trg-thorn` + `trg-monsters` + `trg-combat` (round 1, Wolf's turn; Brakka at initiative 17).
 * `PP_TEST_MODE=1` for the walkthrough. The orchestrator stacks it into `session-sim-7` (S10).
 */
export default defineBundle({
  name: "rule-triggers",
  includes: ["effect-modifiers"],
  fixtures: ["mod-tier2", "char-brakka", "trg-brakka", "trg-thorn", "trg-monsters", "trg-combat"],
});
