import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CMP §13 `compendium` = `base` + `player-2` + `campaign-second` + `char-mira` + `char-thorn` +
 * `enemy-1` + `enemy-2` + `enemy-custom` + `images` + `battlemap` + `encounter-1` +
 * `cmp-srd-mini` + `cmp-homebrew` + `cmp-homebrew-second`.
 */
export default defineBundle({
  name: "compendium",
  includes: ["base"],
  fixtures: [
    "player-2",
    "campaign-second",
    "char-mira",
    "char-thorn",
    "enemy-1",
    "enemy-2",
    "enemy-custom",
    "images",
    "battlemap",
    "encounter-1",
    "cmp-srd-mini",
    "cmp-homebrew",
    "cmp-homebrew-second",
  ],
});
