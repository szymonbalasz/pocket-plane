import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { editStep, entityOf, putRowStep } from "../character-sheet-full/steps";

/**
 * VFX §13 `sg-row`: Mira casts with WIS (two 3rd-level slots) and has the spell row **Spirit
 * Guardians** (3rd, concentration) with its map effect: Spirit Guardians, radiant, 15 ft.
 */
export default defineFixture({
  key: "sg-row",
  kind: "setup",
  requires: ["char-mira"],
  ownerSpec: "spell-fx",
  steps: [
    editStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      set: { spellcasting: { ability: "wis", slots: { "1": 2, "3": 2 } } },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "spells",
      row: {
        name: "Spirit Guardians",
        level: 3,
        prepared: true,
        concentration: true,
        notes: "15 ft emanation; 3d8 radiant, WIS save for half.",
        fx: { preset: "spirit-guardians", params: { variant: "radiant" } },
      },
    })),
  ],
});
