import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * FR-CMP-77 `sheet-links`: `base` + Mira's full sheet with rows named like compendium entries + the
 * SRD mini and homebrew (shared and DM-only), with one name two entries share.
 */
export default defineBundle({
  name: "sheet-links",
  includes: ["base"],
  fixtures: [
    "char-mira",
    "char-mira-full",
    "cmp-srd-mini",
    "cmp-homebrew",
    "share-mira-rows",
    "sheet-links-rows",
  ],
});
