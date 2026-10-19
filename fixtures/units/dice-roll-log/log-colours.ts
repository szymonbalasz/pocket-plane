import { rollCommand } from "@server/features/dice-roll-log/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { DiceRollIntent } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * DICE §13 / CAMP §13 K6, K12 (sprint 5 K4): three public roll lines whose actor names take the
 * roller's colour, dice seeded per fixture key. e1 `player-1` rolls Mira's Athletics 1d20+2
 * (jade, or rose after K2); e2 `player-2` rolls 1d20 as themself ("Player 2", blue); e3 the DM
 * rolls Mira's DEX save 1d20+2 (amber: the DM is the roller).
 */
export default defineFixture({
  key: "log-colours",
  kind: "setup",
  requires: ["player-1", "player-2", "char-mira"],
  ownerSpec: "dice-roll-log",
  steps: [
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+2",
        category: "skill-check",
        label: "Athletics",
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
      }),
      { as: "player-1" },
    ),
    step(rollCommand, { expression: "1d20", category: "other" }, { as: "player-2" }),
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+2",
        category: "saving-throw",
        label: "DEX save",
        public: true,
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
      }),
    ),
  ],
});
