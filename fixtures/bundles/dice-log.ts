import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** DICE §13: `base` + `player-2` + `char-mira` + `char-thorn` + `enemy-1` + settings + rolls. */
export default defineBundle({
  name: "dice-log",
  includes: ["base"],
  fixtures: ["player-2", "char-mira", "char-thorn", "enemy-1", "dice-settings", "rolls-1"],
});
