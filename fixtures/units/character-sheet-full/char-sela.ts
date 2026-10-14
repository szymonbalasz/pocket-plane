import { charCreate } from "@server/features/character-sheet/lifecycle";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { CharCreateIntent } from "@shared/character-sheet/sheet";
import { editStep, entityOf, putRowStep } from "./steps";

/**
 * **Draft** "Sela" for `player-2`, as a player would make it (CHARX §13): Cleric 1 d8, Dwarf,
 * WIS 16, Medicine + Insight, spellcasting WIS, slots 1: 2; Sacred Flame (save DEX, 1d8
 * radiant), Guiding Bolt (attack, 4d6 radiant), Cure Wounds (no roll, 1d8+3 healing);
 * "SELA-NOTE-3". Spell attack +5, DC 13.
 */
export default defineFixture({
  key: "char-sela",
  kind: "setup",
  requires: ["player-2"],
  ownerSpec: "character-sheet-full",
  steps: [
    step(
      charCreate,
      (r): CharCreateIntent => ({
        name: "Sela",
        ownerPlayerId: r.id("player-2", "player"),
        draft: true,
      }),
    ),
    editStep((r) => ({
      creatureId: entityOf(r, "char-sela"),
      set: {
        classes: [{ name: "Cleric", level: 1, hitDie: "d8" }],
        species: "Dwarf",
        ac: 16,
        hpMax: 10,
        speed: 25,
        abilities: { str: 12, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
        saveProficiencies: ["wis", "cha"],
        skills: { medicine: "proficient", insight: "proficient" },
        spellcasting: { ability: "wis", slots: { "1": 2 } },
        notes: "SELA-NOTE-3",
      },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-sela"),
      list: "spells",
      row: {
        name: "Sacred Flame",
        level: 0,
        roll: "save",
        saveAbility: "dex",
        damage: "1d8",
        effect: "damage",
        damageType: "radiant",
      },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-sela"),
      list: "spells",
      row: {
        name: "Guiding Bolt",
        level: 1,
        prepared: true,
        roll: "attack",
        damage: "4d6",
        effect: "damage",
        damageType: "radiant",
      },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-sela"),
      list: "spells",
      row: { name: "Cure Wounds", level: 1, prepared: true, damage: "1d8+3", effect: "healing" },
    })),
  ],
});
