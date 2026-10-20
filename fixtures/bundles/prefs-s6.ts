import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Play-shell / CAMP §13 sprint 6 (track PF) `prefs-s6` = `player-colours` (map-tools +
 * `pc-colours`) + `pc-colour-free` + `loot-1`: DM amber, Player 1 jade (default), Player 2
 * lavender `#b388ff`; with lavender taken, Blue and Sky are too close for Player 1. The PF
 * walkthrough's bundle.
 */
export default defineBundle({
  name: "prefs-s6",
  includes: ["player-colours"],
  fixtures: ["pc-colour-free", "loot-1"],
});
