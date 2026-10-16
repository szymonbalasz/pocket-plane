import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * PARTY §13: `base` + `player-2` + `images` + `char-mira` + `char-thorn` + `char-mira-full` +
 * `campaign-second` + `loot-1` + `loot-wallets` + `handout-images` + `handouts-1` +
 * `party-items-1` + `party-second`. Pot 5 pp, 30 gp (LOOT).
 */
export default defineBundle({
  name: "party-board",
  includes: ["base"],
  fixtures: [
    "player-2",
    "images",
    "char-mira",
    "char-thorn",
    "char-mira-full",
    "campaign-second",
    "loot-1",
    "loot-wallets",
    "handout-images",
    "handouts-1",
    "party-items-1",
    "party-second",
  ],
});
