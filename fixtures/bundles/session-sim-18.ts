import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * The full session simulation after the linked notes (NOTES build §1.4, slice N7):
 * `session-sim-17` + `player-2` and `campaign-second` (already in sim-17 through sim-7; listed for
 * the notes units, the loader adds each once) + the `notes` units: "Burnt Ledger", "Quest log",
 * "Duke Varen" (links, `2d6`), "Old rumours" in the Recycle bin, and the canary "Burnt Ledger"
 * (`CANARY-OTHER`) in the Second Campaign. `notes-second-campaign` activates the Second Campaign
 * and then the Fixture Campaign again; the running ambush and the shown overview stay.
 */
export default defineBundle({
  name: "session-sim-18",
  includes: ["session-sim-17"],
  fixtures: [
    "player-2",
    "campaign-second",
    "notes-shared",
    "notes-binned",
    "notes-second-campaign",
  ],
});
