import { attackCommand } from "@server/features/combat-tracker/attack";
import { applyCard } from "@server/features/combat-tracker/hp";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "./combat-1";

/**
 * CBT §13 `combat-hit`: Goblin attacks, manual 15 / 4 (19 to hit, 6 slashing) → card; the DM
 * applies it to Mira (AC 16): hit, normal → Mira 6 / 12.
 */
export default defineFixture({
  key: "combat-hit",
  kind: "setup",
  requires: ["combat-1"],
  ownerSpec: "combat-tracker",
  steps: [
    step(attackCommand, (r) => ({
      attackerId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.goblin),
      manual: [{ diceTotal: 15 }, { diceTotal: 4 }],
    })),
    step(applyCard, (r) => ({
      cardId: r.id("combat-hit", "notification"),
      targetId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.mira),
      toHitTotal: 19,
      hit: true,
      damageTotal: 6,
      multiplier: "normal" as const,
    })),
  ],
});
