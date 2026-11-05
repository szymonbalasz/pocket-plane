import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * NOTES build §1.1 `notes`: `base` + `player-2` + `campaign-second` + `notes-shared` +
 * `notes-binned` + `notes-second-campaign`.
 */
export default defineBundle({
  name: "notes",
  includes: ["base"],
  fixtures: [
    "player-2",
    "campaign-second",
    "notes-shared",
    "notes-binned",
    "notes-second-campaign",
  ],
});
