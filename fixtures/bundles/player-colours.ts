import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CAMP §13 (sprint 5, track K) `player-colours` = `map-tools` (Goblin Ambush with Mira
 * `player-1`, Thorn `player-2`, Goblin Sneak; kept templates Spirit Guardians `player-1`,
 * Thunderwave `player-2`, Web and hidden Glyph DM) + `pc-colours`: Player 1 jade, Player 2 blue,
 * the DM amber.
 */
export default defineBundle({
  name: "player-colours",
  includes: ["map-tools"],
  fixtures: ["pc-colours"],
});
