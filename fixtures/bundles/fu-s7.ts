import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint 7 FU-combat `fu-s7` (play-shell §13): `session-sim-10` + `cp-ally` (Goblin 2 → Mira's
 * charmed companion) + `fu-hurt-goblins` (Goblin 0 / 7, Goblin 2 4 / 7), on top of sim-10's running
 * ambush; no turn change. The FU walkthrough's bundle.
 */
export default defineBundle({
  name: "fu-s7",
  includes: ["session-sim-10"],
  fixtures: ["cp-ally", "fu-hurt-goblins"],
});
