import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBT §13.3 `companions` (sprint 6, track CP): `late-damage` + the SRD refs + both pets (part 2
 * and the integration tests). CP0 creates it; CP3 appends `cp-combat` when it lands.
 */
export default defineBundle({
  name: "companions",
  includes: ["late-damage"],
  fixtures: [
    "cp-srd",
    // CP0: Mira's Owlbear (after-owner) and Brakka's Drake Companion (in-owner-turn), tokens placed
    "pet-owlbear",
    "pet-drake",
    // CP3: both pets join the ambush; Fire Elementals summoned for Mira (after her), Brakka (in her
    // turn) and Thorn (own initiative 9, linked to his Conjure Elemental)
    "cp-combat",
  ],
});
