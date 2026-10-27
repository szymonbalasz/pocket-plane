import { defineFixture, type Refs } from "@server/features/fixtures-adapters/fixture-types";
import { CHARX_INTENTS, type CharUseResourceIntent } from "@shared/character-sheet/sheet";
import { editStep, entityOf, putRowStep } from "./steps";

/**
 * Kit parity K13 (DM #363, the kit's wide sheet): Mira gets spellcasting WIS with two 1st-level
 * slots (one used) and Hunter's Mark (1d6 damage), so the wide Main shows the kit's Spells box
 * with slot pips beside Attacks and Limited uses (Second Wind, `char-mira-full`).
 */
export default defineFixture({
  key: "kit-mira-spells",
  kind: "setup",
  requires: ["char-mira-full"],
  ownerSpec: "character-sheet-full",
  steps: [
    editStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      set: { spellcasting: { ability: "wis", slots: { "1": 2 } } },
    })),
    {
      command: CHARX_INTENTS.useResource,
      input: (r: Refs): CharUseResourceIntent => ({
        characterId: entityOf(r, "char-mira"),
        resource: { slot: 1 },
        delta: 1,
      }),
    },
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "spells",
      row: {
        name: "Hunter's Mark",
        level: 1,
        prepared: true,
        concentration: true,
        damage: "1d6",
        effect: "damage",
        damageType: "force",
        notes: "Bonus action, concentration: +1d6 force on each hit.",
      },
    })),
  ],
});
