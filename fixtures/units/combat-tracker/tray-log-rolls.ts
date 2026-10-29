import { rollCommand } from "@server/features/dice-roll-log/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { DiceRollIntent } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * CBT §13.8 `tray-log-rolls` (sprint 15, #385): three unused plain log entries during the fight,
 * before its first card, for Use as attack / damage (FR-CBT-173): (a) the DM's "2d6" as DM,
 * hidden; (b) `player-1`'s "1d20+5" as Mira, public; (c) `player-1`'s "1d8+1d6" as themselves
 * ("me"), public. Dice seeded per fixture key.
 */
export default defineFixture({
  key: "tray-log-rolls",
  kind: "setup",
  requires: ["trg-combat"],
  ownerSpec: "combat-tracker",
  steps: [
    step(rollCommand, (): DiceRollIntent => ({ expression: "2d6", public: false })),
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+5",
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
      }),
      { as: "player-1" },
    ),
    step(rollCommand, (): DiceRollIntent => ({ expression: "1d8+1d6" }), { as: "player-1" }),
  ],
});
