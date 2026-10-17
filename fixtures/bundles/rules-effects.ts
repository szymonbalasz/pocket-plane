import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * MOD §13.1 `rules-effects` = `rule-triggers` + `weapon-flame-tongue` + `mod-fire-ward` +
 * `uses-rage-spent` + `trg-mira-uses` (Mira's full sheet first: Searing Strike lives on it).
 * Sprint-4 track R walkthrough; the orchestrator stacks the four units onto `session-sim-7`.
 */
export default defineBundle({
  name: "rules-effects",
  includes: ["rule-triggers"],
  fixtures: [
    "char-mira-full",
    "weapon-flame-tongue",
    "mod-fire-ward",
    "uses-rage-spent",
    "trg-mira-uses",
  ],
});
