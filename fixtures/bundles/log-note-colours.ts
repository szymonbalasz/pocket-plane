import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CAMP §13 K6, K7, K12 (sprint 5 K4) `log-note-colours` = `player-colours` + `log-colours`
 * (three roll lines: Player 1 / Mira jade, Player 2 blue, the DM for Mira amber) + `note-colours`
 * (Player 1's pending card, the DM's info to Player 2, a row resolved by Player 1). Test mode
 * (`PP_TEST_MODE=1`, for `note.testSend`).
 */
export default defineBundle({
  name: "log-note-colours",
  includes: ["player-colours"],
  fixtures: ["log-colours", "note-colours"],
});
