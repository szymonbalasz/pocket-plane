import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * DICEX §13 sprint 5 (dice polish: landing, popup line, tray preview, Alt hint, damage types in
 * the physical form): `dice-display` + `char-brakka` (Brakka, owned by `player-1`) +
 * `weapon-flame-tongue` (`1d20+8`, `2d6+5` slashing + `2d6` fire). No new unit (no new record
 * type); patches over existing units (seams S10).
 */
export default defineBundle({
  name: "dice-polish",
  includes: ["dice-display"],
  fixtures: ["char-brakka", "weapon-flame-tongue"],
});
