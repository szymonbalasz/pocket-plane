import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Screenshot baselines (#368, e2e `visual`): `kit-round3-combat`'s world (every kit section, the
 * round-3 fight, companion groups) in its own server, so no other spec's edits reach the
 * baselines. Existing record types only. Spell FX build: both auras (Mira's Spirit Guardians,
 * Thorn's Shadow of Moil) on existing effects, drawn at Still.
 */
export default defineBundle({
  name: "visual-kit",
  includes: ["kit-round3-combat"],
  fixtures: ["vfx-visual-auras"],
});
