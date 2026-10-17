import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { editStep, entityOf } from "../character-sheet-full/steps";

const LEGACY = { visionFt: 0, darkvisionFt: 0, seesMagicalDarkness: false };

/**
 * FOG §13 (sprint 4) `vision-legacy`: a patch, Mira's and Thorn's `senses` stored as all 0 / false,
 * so bundles written before the 999 ft default (FR-FOG-32, #243 [1]) keep their exact sight (none:
 * the static fog only). In the `fog` bundle (review A4 audit), hence `fog-scn` too.
 */
export default defineFixture({
  key: "vision-legacy",
  kind: "setup",
  requires: ["char-mira", "char-thorn"],
  ownerSpec: "fog-of-war",
  steps: [
    editStep((r) => ({ creatureId: entityOf(r, "char-mira"), set: { senses: LEGACY } })),
    editStep((r) => ({ creatureId: entityOf(r, "char-thorn"), set: { senses: LEGACY } })),
  ],
});
