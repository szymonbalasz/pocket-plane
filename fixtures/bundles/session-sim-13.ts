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
    // SP: rules quick reference (CMP §13.3; `cmp-rule-house` stays in sp-rules / sp-s9)
    "cmp-rules-mini",
    // RS: reminders + strongholds (FR-REM-28, FR-HOLD-36)
    "rem-party",
    "rem-mira-charm",
    "rem-thorn-own",
    "rem-thorn-secret",
    "hold-greystone",
    "hold-greystone-reminders",
    "hold-greystone-stores",
    "hold-tower-secret",
    // FX: fix pack (FX1 toasts + kill feed: no unit; `fx-toasts-e2e` aliases session-sim-12)
    // FX: FX3 Mira's Bless beside Thorn's summon concentration (FR-CBTX-75)
    "fx-mira-bless",
    // T1 (sprint 10, DM #343): Dice tray 40 % bigger (no unit: client-only, the tray needs no records)
    // T5 (sprint 10, DM #347): dice visuals: thin d20 lines, tray +25 %, roll popup +40 % (no unit: client-only)
    // F2 (sprint 11, DM #349): toast keep-outs and settle, BL-108 / BL-115 (no unit: client-only)
    // F1 (sprint 11, DM #349): frame + camera fixes, BL-107 / BL-109 / BL-113 (no unit: client-only)
    // F3 (sprint 11, DM #349): skip toast, tray after a prompt answer, Add hidden (no unit: client-only;
    // `f3-down-companions` changes existing HP, so it stays in `f3-combat-dice`)
    // CS (sprint 12, DM #353): printed sheet layout, FR-CHARX-105–120 (no unit: layout only)
    // T1 (sprint 12, DM #353): theme switch (no unit: client-only, browser storage)
  ],
});
