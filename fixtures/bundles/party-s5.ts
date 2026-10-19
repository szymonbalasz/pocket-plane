import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * PARTY §13.1 (P0): `party-board` + `cmp-srd-mini` (SRD Potion of Healing, Bag of Holding,
 * Longsword) + `handout-attachment` (h6 with an attachment, unshared) + `handout-present-1` (h2
 * presented to player-1).
 */
export default defineBundle({
  name: "party-s5",
  includes: ["party-board"],
  fixtures: ["cmp-srd-mini", "handout-attachment", "handout-present-1"],
});
