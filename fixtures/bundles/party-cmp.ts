import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * PARTY §13.1 (P4, review #19): `party-board` + `cmp-srd-mini` (SRD Potion of Healing), existing
 * units only. Walkthrough S5-9: Add to party ×2 merges into `party-items-1`'s "Potion of healing"
 * ×2 → ×4.
 */
export default defineBundle({
  name: "party-cmp",
  includes: ["party-board"],
  fixtures: ["cmp-srd-mini"],
});
