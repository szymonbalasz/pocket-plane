import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Kit parity K13 (round 3, DM #363: wide sheet, compendium rows, top bar; e2e `kit-round3`):
 * `theme-gilt` (Mira's full sheet mid-fight, Thorn) + Mira's spell slots and Hunter's Mark (the
 * wide Main's Spells box), Mira's concentration and Bless chips (the effects menu after them), the SRD mini set (compendium rows), Mira's pet Owlbear (Party Manager's
 * New pet… beside a companion row) and the DM's open roll request (a launcher badge, the red
 * gem). Existing record types only.
 */
export default defineBundle({
  name: "kit-round3",
  includes: ["theme-gilt"],
  fixtures: [
    "kit-mira-spells",
    "cbtx-effects",
    "cmp-srd-mini",
    "cp-srd",
    "pet-owlbear",
    "dicex-request-open",
  ],
});
