import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Kit parity §13 K4 (compendium table, stat block card, Party status cards, Creatures medallions,
 * sheet header walkthrough; e2e `kit-library`): `theme-gilt` (Mira's full sheet, Thorn, the round-3
 * fight) + the SRD mini set for the compendium table + Mira's pet Owlbear (a companion row under
 * her card). Existing units only; no new record type.
 */
export default defineBundle({
  name: "kit-library",
  includes: ["theme-gilt"],
  fixtures: ["cmp-srd-mini", "cp-srd", "pet-owlbear"],
});
