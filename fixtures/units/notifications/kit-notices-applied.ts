import { attackCommand } from "@server/features/combat-tracker/attack";
import { fixtureSeededId } from "@server/features/combat-tracker/fixtures";
import { applyCard } from "@server/features/combat-tracker/hp";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";
import { miraCrossbowId } from "../combat-tracker/late-hit-ruled";

/**
 * Kit parity §13 K3 `kit-notices-applied`: as `player-1`, Mira's Light crossbow, manual 14 / 5
 * (to hit + damage) → card; the DM applies it on Goblin 2 (hit, normal) → the player's card view
 * reads "Hit Goblin 2: N" with the damage in a Result box (FR-KIT-66).
 */
export default defineFixture({
  key: "kit-notices-applied",
  kind: "setup",
  requires: ["combat-1", "char-mira-full"],
  ownerSpec: "notifications",
  steps: [
    step(
      attackCommand,
      (r) => ({
        attackerId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.mira),
        attackId: miraCrossbowId(),
        manual: [{ diceTotal: 14 }, { diceTotal: 5 }],
      }),
      { as: "player-1" },
    ),
    step(applyCard, (r) => ({
      cardId: r.id("kit-notices-applied", "notification"),
      toHitTotal: 18,
      damageTotal: 7,
      // FR-CBT-94 / -129: the attack's seeded to-hit and damage rolls (the fixture test asserts).
      damageRollId: fixtureSeededId("kit-notices-applied", 1),
      partRollIds: { toHit: fixtureSeededId("kit-notices-applied", 0), extra: [] },
      targets: [
        {
          targetId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.goblin2),
          hit: true,
          multiplier: "normal" as const,
        },
      ],
    })),
  ],
});
