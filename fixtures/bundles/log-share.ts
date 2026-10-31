import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * SHARE §13 `log-share`: `base` + `player-2` + Mira's full sheet with rows named like compendium
 * entries (`share-mira-rows`) + the SRD mini, homebrew (shared and DM-only) and rule cards.
 */
export default defineBundle({
  name: "log-share",
  includes: ["base"],
  fixtures: [
    "player-2",
    "char-mira",
    "char-mira-full",
    "cmp-srd-mini",
    "cmp-homebrew",
    "cmp-rules-mini",
    "cmp-rule-house",
    "share-mira-rows",
  ],
});
