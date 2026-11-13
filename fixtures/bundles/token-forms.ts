import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * FORM §13 `token-forms`: `base` + `player-2`; Mira (player-1) with forms Raging and Enlarged and
 * a "Rage" preset linked to Raging (`mira-forms`); her token on Town (active, own art `token-mira`)
 * and on Goblin Ambush (inactive).
 */
export default defineBundle({
  name: "token-forms",
  includes: ["base"],
  fixtures: [
    "player-2",
    "char-mira",
    "enemy-1",
    "enemy-2",
    "enemy-custom",
    "images",
    "town",
    "battlemap",
    "mira-forms",
  ],
});
