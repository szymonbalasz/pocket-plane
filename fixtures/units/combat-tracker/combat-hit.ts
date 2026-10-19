import { attackCommand } from "@server/features/combat-tracker/attack";
import { fixtureSeededId } from "@server/features/combat-tracker/fixtures";
import { applyCard } from "@server/features/combat-tracker/hp";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "./combat-1";

/**
 * CBT §13 `combat-hit`: Goblin attacks, manual 15 / 4 (19 to hit, 6 slashing) → card; the DM
 * applies it with targets `[{Mira (AC 16), hit, normal}]` → Mira 6 / 12.
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
      toHitTotal: 19,
      damageTotal: 6,
      // FR-CBT-94: the attack's second seeded ID is its damage roll (the fixture test asserts it).
      damageRollId: fixtureSeededId("combat-hit", 1),
      targets: [
        {
          targetId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.mira),
          hit: true,
          multiplier: "normal" as const,
        },
      ],
    })),
  ],
});
