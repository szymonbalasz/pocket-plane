import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CHAR §13: `base` + `player-2` + `char-mira` + `char-thorn` + `char-pip` + `char-wounds`.
 * Game-log settings at defaults (all hidden). No scenes.
 */
export default defineBundle({
  name: "character-sheet",
  includes: ["base"],
  fixtures: ["player-2", "char-mira", "char-thorn", "char-pip", "char-wounds"],
});
