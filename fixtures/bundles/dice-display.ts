import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * DICEX §13 sprint 4 (die shapes, dice layer, roll popup): `combat` (session-sim + `player-2` +
 * `char-thorn` + `thorn-battlemap`; encounter "Ambush at the Ford") + `rolls-1` (log history with
 * the hidden "DM-SECRET-ROLL") + `dicex-looks` + `dicex-notation-text`. No new unit (no new
 * record type); patches over existing units (seams S10).
 */
export default defineBundle({
  name: "dice-display",
  includes: ["combat"],
  fixtures: ["rolls-1", "dicex-looks", "dicex-notation-text"],
});
