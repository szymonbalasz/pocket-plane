import { rollCommand } from "@server/features/dice-roll-log/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { adjustGems, spendGem } from "@server/features/gems/commands";

const KEY = "sb-luck-reroll";

/**
 * STATS §13.1 `sb-luck-reroll` (`stats-b` only, never session-sim-12: it needs `gems-on`): Mira's
 * physical Perception 4 (Player 1), the DM awards her an Inspiration gem, she rerolls it to 17.
 * Luck counts only the final roll: Mira + 1 roll, d20 face 17 (the 4 never counts).
 */
export default defineFixture({
  key: KEY,
  kind: "setup",
  requires: ["gems-on", "sb-luck-rolls", "char-mira", "player-1"],
  ownerSpec: "stats",
  steps: [
    step(
      rollCommand,
      (r) => ({
        expression: "1d20+3",
        category: "skill-check" as const,
        label: "Perception",
        actor: { entityId: r.id("char-mira", "entity") },
        manual: { diceTotal: 4 },
      }),
      { as: "player-1" },
    ),
    step(adjustGems, (r) => ({
      characterId: r.id("char-mira", "entity"),
      gem: "inspiration" as const,
      delta: 1,
    })),
    step(
      spendGem,
      (r) => ({
        characterId: r.id("char-mira", "entity"),
        gem: "inspiration" as const,
        entryId: r.id(KEY, "game-log-entry", 0),
        manual: { diceTotal: 17 },
      }),
      { as: "player-1" },
    ),
  ],
});
