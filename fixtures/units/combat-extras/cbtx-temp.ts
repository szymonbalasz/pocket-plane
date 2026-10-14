import { setTempHp } from "@server/features/combat-extras/play-state";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";

/** CBTX §13 `cbtx-temp`: Thorn temp HP 5; Goblin temp HP 3. */
export default defineFixture({
  key: "cbtx-temp",
  kind: "setup",
  requires: ["combat-1"],
  ownerSpec: "combat-extras",
  steps: [
    step(setTempHp, (r) => ({
      target: { characterId: r.id("char-thorn", ENTITY_TYPE) },
      value: 5,
    })),
    step(setTempHp, (r) => ({
      target: { combatantId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.goblin) },
      value: 3,
    })),
  ],
});
