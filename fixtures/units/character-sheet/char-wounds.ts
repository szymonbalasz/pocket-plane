import { charAdjustHp } from "@server/features/character-sheet/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { CharAdjustHpIntent } from "@shared/character-sheet/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/** `char.adjustHp` Thorn −7 → 3 / 10 (CHAR §13). */
export default defineFixture({
  key: "char-wounds",
  kind: "setup",
  requires: ["char-thorn"],
  ownerSpec: "character-sheet",
  steps: [
    step(
      charAdjustHp,
      (r): CharAdjustHpIntent => ({ characterId: r.id("char-thorn", ENTITY_TYPE), delta: -7 }),
    ),
  ],
});
