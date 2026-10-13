import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * LOOT §13: `base` + `player-2` + `char-mira` + `char-thorn` + `campaign-second` + `loot-1` +
 * `loot-wallets` + `loot-second`.
 */
export default defineBundle({
  name: "party-loot",
  includes: ["base"],
  fixtures: [
    "player-2",
    "char-mira",
    "char-thorn",
    "campaign-second",
    "loot-1",
    "loot-wallets",
    "loot-second",
  ],
});
