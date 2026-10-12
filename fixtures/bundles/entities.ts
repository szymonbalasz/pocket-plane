import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** entities §13: `base` + `player-2` + `campaign-second` + the six entities fixtures. */
export default defineBundle({
  name: "entities",
  includes: ["base"],
  fixtures: [
    "player-2",
    "campaign-second",
    "enemy-1",
    "enemy-2",
    "enemy-custom",
    "char-mira",
    "char-thorn",
    "enemy-custom-second",
  ],
});
