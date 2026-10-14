import { charSetLock } from "@server/features/character-sheet/lifecycle";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { CharSetLockIntent } from "@shared/character-sheet/sheet";
import { entityOf } from "./steps";

/** `char.setLock` Mira locked (CHARX §13). */
export default defineFixture({
  key: "char-mira-locked",
  kind: "setup",
  requires: ["char-mira-full"],
  ownerSpec: "character-sheet-full",
  steps: [
    step(
      charSetLock,
      (r): CharSetLockIntent => ({ characterId: entityOf(r, "char-mira"), locked: true }),
    ),
  ],
});
