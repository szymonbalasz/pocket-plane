import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBT §13.3 `companions-start` (sprint 6, review 7): `session-sim` (no running fight;
 * "Ambush at the Ford" planned) + Mira's Owlbear and Thorn's Wolf with tokens on the map: the DM
 * Starts with both pets (FR-CBT-109). Needs only CP0 (walkthrough S1–S4).
 */
export default defineBundle({
  name: "companions-start",
  includes: ["session-sim"],
  fixtures: ["cp-srd", "pet-owlbear", "cp-pet-thorn"],
});
