import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { editStep, entityOf, putRowStep } from "../character-sheet-full/steps";

/**
 * VFX §13 `moil-row`: Thorn casts with CHA (one 4th-level slot) and has the spell row **Shadow of
 * Moil** (4th, concentration) with its map effect: Shadow of Moil, 10 ft.
 */
export default defineFixture({
  key: "moil-row",
  kind: "setup",
  requires: ["char-thorn"],
  ownerSpec: "spell-fx",
  steps: [
    editStep((r) => ({
      creatureId: entityOf(r, "char-thorn"),
      set: { spellcasting: { ability: "cha", slots: { "4": 1 } } },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-thorn"),
      list: "spells",
      row: {
        name: "Shadow of Moil",
        level: 4,
        prepared: true,
        concentration: true,
        notes: "Attackers who hit take 2d8 necrotic.",
        fx: { preset: "shadow-of-moil", params: {} },
      },
    })),
  ],
});
