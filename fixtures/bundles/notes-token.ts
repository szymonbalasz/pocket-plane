import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * NOTES N9 (FR-NOTES-29) `notes-token`: `base` + `player-2`, Town active with Mira (player-1's
 * character token), a visible NPC also named "Mira" and a hidden "Shadow"; the shared notes.
 */
export default defineBundle({
  name: "notes-token",
  includes: ["base"],
  fixtures: [
    "player-2",
    "char-mira",
    "enemy-1",
    "enemy-2",
    "images",
    "town",
    "notes-tokens",
    "notes-shared",
  ],
});
