import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * VFX §13 `spell-fx` = `map-tools` (Goblin Ambush; Mira `player-1`, Thorn `player-2`, Goblin
 * Sneak) + `vfx-fight` (Goblin Ambush live, "Spell FX" round 1: Mira, Goblin Sneak, Thorn) +
 * `sg-row` (Mira's Spirit Guardians row) + `moil-row` (Thorn's Shadow of Moil row) + `fire-card`
 * (Mira's pending Fire Bolt card, 7 fire).
 */
export default defineBundle({
  name: "spell-fx",
  includes: ["map-tools"],
  fixtures: ["vfx-fight", "sg-row", "moil-row", "fire-card"],
});
