import { rollCommand } from "@server/features/dice-roll-log/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { DiceRollIntent } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * Kit parity §13 (K1, FR-KIT-40–46): the kit's Game log rows, rolled by `player-1` as Mira, so the
 * names and medallions take player-1's colour. Physical dice, so the boxes' outcomes are fixed:
 * e1 "Longbow attack" 1d20+9 = 29, natural 20 (crit); e2 "Longbow damage" 2d8+4 = 16 (damage);
 * e3 "Healing Word" 1d4+3 (heal, dice seeded per fixture key).
 */
export default defineFixture({
  key: "kit-log-rolls",
  kind: "setup",
  requires: ["player-1", "char-mira"],
  ownerSpec: "kit-parity",
  steps: [
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+9",
        category: "attack",
        label: "Longbow attack",
        manual: { diceTotal: 20, dice: [20] },
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
      }),
      { as: "player-1" },
    ),
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "2d8+4",
        category: "damage",
        label: "Longbow damage",
        manual: { diceTotal: 12, dice: [5, 7] },
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
      }),
      { as: "player-1" },
    ),
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d4+3",
        category: "healing",
        label: "Healing Word",
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
      }),
      { as: "player-1" },
    ),
  ],
});
