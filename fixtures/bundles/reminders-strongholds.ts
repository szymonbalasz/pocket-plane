import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * REM §13 / HOLD §13: `party-board` (base, player-2, Mira, Thorn, party items, loot,
 * campaign-second) + the REM units (FR-REM-27) + the HOLD units (FR-HOLD-35).
 */
export default defineBundle({
  name: "reminders-strongholds",
  includes: ["party-board"],
  fixtures: [
    "rem-party",
    "rem-mira-charm",
    "rem-thorn-own",
    "rem-thorn-secret",
    "hold-greystone",
    "hold-greystone-reminders",
    "hold-greystone-stores",
    "hold-tower-secret",
    "hold-tower-move",
  ],
});
