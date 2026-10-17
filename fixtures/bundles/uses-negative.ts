import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * MOD §13.1 negative uses (S4-2, FR-CHARX-58, FR-MOD-59) = `rule-triggers` + `char-mira-full` +
 * `uses-rage-spent` (Brakka's Rage 0 / 3 left) + `trg-mira-uses` (Mira's Searing Strike 1 / 2
 * left, a `feature` trigger). Own name so `e2e/uses-negative.e2e.ts` gets its own server until
 * `rules-effects` is registered (S4-4).
 */
export default defineBundle({
  name: "uses-negative",
  includes: ["rule-triggers"],
  fixtures: ["char-mira-full", "uses-rage-spent", "trg-mira-uses"],
});
