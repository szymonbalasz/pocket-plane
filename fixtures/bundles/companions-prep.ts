import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBT §13.3 `companions-prep` (sprint 6, track CP): `late-damage` + the SRD Owlbear and Fire
 * Elemental; walkthrough part 1 (the DM creates the pet and the summon through the UI).
 */
export default defineBundle({
  name: "companions-prep",
  includes: ["late-damage"],
  fixtures: ["cp-srd"],
});
