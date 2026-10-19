import { attackCommand } from "@server/features/combat-tracker/attack";
import { fixtureSeededId } from "@server/features/combat-tracker/fixtures";
import { applyHitCommand } from "@server/features/combat-tracker/hit";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "./combat-1";

/** Mira's Light crossbow: `char-mira-full`'s third seeded ID (the fixture test asserts it). */
export const miraCrossbowId = () => fixtureSeededId("char-mira-full", 2);

/**
 * CBT §13.1 `late-hit-ruled` (sprint 5, R1): as `player-1`, Mira's Light crossbow to-hit only →
 * card "Mira: 15 to hit (Light crossbow)"; the DM's Apply hit on Goblin 2 (hit) → a pending card
 * in its damage step, waiting for damage (FR-CBT-88, -89). The d20 is 9, not §13.1's 11: Mira is
 * Blessed in `rules-effects` (+1d4, seeded 2), so 9 + 4 + 2 = 15.
 */
export default defineFixture({
  key: "late-hit-ruled",
  kind: "setup",
  requires: ["combat-1", "char-mira-full"],
  ownerSpec: "combat-tracker",
  steps: [
    step(
      attackCommand,
      (r) => ({
        attackerId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.mira),
        attackId: miraCrossbowId(),
        rolls: "toHit" as const,
        manual: [{ diceTotal: 9 }],
      }),
      { as: "player-1" },
    ),
    step(applyHitCommand, (r) => ({
      cardId: r.id("late-hit-ruled", "notification"),
      toHitTotal: 15,
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
