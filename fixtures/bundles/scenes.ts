import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** MAP §13: `base` + player-2, both characters, three enemies, images, town, battlemap, extras. */
export default defineBundle({
  name: "scenes",
  includes: ["base"],
  fixtures: [
    "player-2",
    "char-mira",
    "char-thorn",
    "enemy-1",
    "enemy-2",
    "enemy-custom",
    "images",
    "image-large",
    "town",
    "battlemap",
    "scenes-extras",
  ],
});
