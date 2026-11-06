import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { entityOf, putRowStep } from "../character-sheet-full/steps";

/**
 * VFX §13 `tentacles-row` (FR-VFX-40): Thorn also has the spell row **Evard's Black Tentacles**
 * (4th, concentration) with its map effect: Black Tentacles (a 20 ft cube placed at cast).
 * After `moil-row` (its 4th-level slot).
 */
export default defineFixture({
  key: "tentacles-row",
  kind: "setup",
  requires: ["char-thorn", "moil-row"],
  ownerSpec: "spell-fx",
  steps: [
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-thorn"),
      list: "spells",
      row: {
        name: "Evard's Black Tentacles",
        level: 4,
        prepared: true,
        concentration: true,
        notes: "20 ft square; STR save or 3d6 bludgeoning and restrained.",
        fx: { preset: "black-tentacles", params: {} },
      },
    })),
  ],
});
