import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CBT §13.3 CP5 `cp-tokens` (sprint 6): `companions-start` under its own name (seams S12) for the
 * companion marker e2e: Mira's Owlbear (`player-1`) and Thorn's Wolf (`player-2`) with tokens on
 * Goblin Ambush, no fight running (FR-MAP-76, -77).
 */
export default defineBundle({
  name: "cp-tokens",
  includes: ["companions-start"],
  fixtures: [],
});
