import { attackCommand } from "@server/features/combat-tracker/attack";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "./combat-1";

/** CBT §13 `combat-pending`: Elite attacks, manual 19 / 5 (24 to hit, 8 slashing), left pending. */
export default defineFixture({
  key: "combat-pending",
  kind: "setup",
  requires: ["combat-hit"],
  ownerSpec: "combat-tracker",
  steps: [
    step(attackCommand, (r) => ({
      attackerId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.elite),
      manual: [{ diceTotal: 19 }, { diceTotal: 5 }],
    })),
  ],
});
