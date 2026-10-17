import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { entityOf, putRowStep } from "../character-sheet-full/steps";

/**
 * MOD §13.1 `weapon-flame-tongue` (sprint 4, FR-CHARX-54): Brakka's "Flame Tongue greatsword"
 * attack row: to-hit +7, damage `2d6+4` slashing, `bonus` 1, `extraDamage` [`2d6` fire] (rolls
 * `1d20+8`, `2d6+5` slashing + `2d6` fire once S4-1a builds the rolls). The Greataxe row stays;
 * no other sheet field.
 */
export default defineFixture({
  key: "weapon-flame-tongue",
  kind: "setup",
  requires: ["char-brakka"],
  ownerSpec: "effect-modifiers",
  steps: [
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-brakka"),
      list: "attacks",
      row: {
        name: "Flame Tongue greatsword",
        toHit: 7,
        damage: "2d6+4",
        damageType: "slashing",
        bonus: 1,
        extraDamage: [{ damage: "2d6", type: "fire" }],
      },
    })),
  ],
});
