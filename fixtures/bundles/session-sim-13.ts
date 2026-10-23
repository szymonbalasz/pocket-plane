import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint-9 gate and the DM's "everything on main" bundle: `session-sim-12` + the sprint-9 units,
 * stacked as patches. Created by RS0 (`fix/rs-core`); each sprint-9 track appends its units to its
 * group below in the same branch (keep both lines on a merge). Every unit must be
 * session-sim-12-safe (new rows only; no pot, wallet or sheet change). Not here: `hold-tower-move`
 * (it changes the pot, FR-HOLD-36), `recap-loot-haul` (review ruling 20).
 */
export default defineBundle({
  name: "session-sim-13",
  includes: ["session-sim-12"],
  fixtures: [
    // RS: reminders + strongholds (FR-REM-28, FR-HOLD-36)
    "rem-party",
    "rem-mira-charm",
    "rem-thorn-own",
    "rem-thorn-secret",
    "hold-greystone",
    "hold-greystone-reminders",
    "hold-greystone-stores",
    "hold-tower-secret",
    // FX: FX3 Mira's Bless beside Thorn's summon concentration (FR-CBTX-75)
    "fx-mira-bless",
  ],
});
