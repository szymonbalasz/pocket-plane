import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * MOD §13 `effect-modifiers` = `combat` + `combat-1` + `mod-presets` + `mod-bless` + `mod-bane`
 * + `mod-rage` (round 1, Wolf's turn). Tier-1 contents (FR-MOD-05).
 */
export default defineBundle({
  name: "effect-modifiers",
  includes: ["combat"],
  fixtures: ["combat-1", "mod-presets", "mod-bless", "mod-bane", "mod-rage"],
});
