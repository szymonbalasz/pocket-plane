import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * CHARX §13: bundle `character-sheet` + `enemy-1` + `enemy-custom` + `char-mira-full` +
 * `char-mira-locked` + `char-sela` + `npc-elite-sheet` + `loot-1` + `loot-wallets`.
 * Game-log settings at defaults (all hidden).
 */
export default defineBundle({
  name: "character-sheet-full",
  includes: ["character-sheet"],
  fixtures: [
    "enemy-1",
    "enemy-custom",
    "char-mira-full",
    "char-mira-locked",
    "char-sela",
    "npc-elite-sheet",
    "loot-1",
    "loot-wallets",
  ],
});
