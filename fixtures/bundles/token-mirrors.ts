import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * MIR §13 `token-mirrors` = `map-tools` (Goblin Ambush; Mira `player-1`, Thorn `player-2`, Goblin
 * Sneak) + `mir-goblin` (the scene live, a Transparent mirror of Goblin Sneak).
 */
export default defineBundle({
  name: "token-mirrors",
  includes: ["map-tools"],
  fixtures: ["mir-goblin"],
});
