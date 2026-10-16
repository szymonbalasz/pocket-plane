import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { editStep, entityOf } from "../character-sheet-full/steps";

/**
 * CHARX / FOG §13 `vision-senses`: a patch, one `char.edit {set: {senses}}` per character and no
 * other field (seams S10). Mira: vision 30 ft ("torch"). Thorn: darkvision 60 ft, sees through
 * magical darkness (Devil's Sight). Used by FOG's bundle `vision`.
 */
export default defineFixture({
  key: "vision-senses",
  kind: "setup",
  requires: ["char-mira", "char-thorn"],
  ownerSpec: "character-sheet-full",
  steps: [
    editStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      set: { senses: { visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false } },
    })),
    editStep((r) => ({
      creatureId: entityOf(r, "char-thorn"),
      set: { senses: { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true } },
    })),
  ],
});
