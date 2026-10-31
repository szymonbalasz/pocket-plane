import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * The full session simulation after sim-16 (2026-10-31): `session-sim-13` + the spell rows and
 * overview scenes built since. `ovw-sword-coast` is shown at load (it takes the active scene off);
 * the sim shows Goblin Ambush from Scenes and goes back to the overview during the running fight.
 * Live in the sim, no unit: tray attacks (`tray-log-rolls` needs `trg-combat`'s fight), the game
 * log menu, a door over a wall, gems (DM switches them on). `vfx-fight` and `fire-card` start
 * their own fight, so they stay in `spell-fx`. 5etools: `PP_5ETOOLS_DIR` at a prepared
 * `fixtures/5etools-mini`, read at import, nothing in this bundle.
 */
export default defineBundle({
  name: "session-sim-17",
  includes: ["session-sim-13"],
  fixtures: [
    // Slots: `sg-row` sets them last, so Mira ends on 1st × 2 (one used) + 3rd × 2.
    "kit-mira-spells",
    "sg-row",
    "moil-row",
    "ovw-phandalin",
    "ovw-sword-coast",
  ],
});
