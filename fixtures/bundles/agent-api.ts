import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * AGENT §13 `agent-api` (existing units only): `base` + `player-2`, `images`, `char-mira`,
 * `enemy-1`, `enemy-2`, `enemy-custom` ("Elite Goblin Warrior") + its NPC sheet, `town`,
 * `battlemap`, `cp-srd`, Mira's Owlbear, the mini SRD compendium and homebrew (incl. the unshared
 * `CMP-SECRET-ITEM`).
 */
export default defineBundle({
  name: "agent-api",
  includes: ["base"],
  fixtures: [
    "player-2",
    "images",
    "char-mira",
    "enemy-1",
    "enemy-2",
    "enemy-custom",
    "npc-elite-sheet",
    "town",
    "battlemap",
    "cp-srd",
    "pet-owlbear",
    "cmp-srd-mini",
    "cmp-homebrew",
  ],
});
