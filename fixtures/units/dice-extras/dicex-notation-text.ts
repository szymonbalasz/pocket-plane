import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { entityOf, putRowStep } from "../character-sheet-full/steps";

/** The notation walkthrough text (DICEX §13): links and plain-text cases, FR-DICEX-28. */
export const NOTATION_TEXT =
  "Greataxe 1d12 + 5 slashing. Second Wind d10+1. Hit: 7 (2d6 − 1). Adv: 1d20+3. Not dice: 51d6, 1d1, 2d6/2, 4d6x2, abc1d6.";

/**
 * DICEX §13: one **new** CHARX feature row "Notation test" on Mira (a patch, seams S10: no
 * existing field of `char-mira` changes, so notes keep "MIRA-NOTE-7").
 */
export default defineFixture({
  key: "dicex-notation-text",
  kind: "setup",
  requires: ["char-mira-full"],
  ownerSpec: "dice-extras",
  steps: [
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "features",
      row: { name: "Notation test", source: "fixture", text: NOTATION_TEXT },
    })),
  ],
});
