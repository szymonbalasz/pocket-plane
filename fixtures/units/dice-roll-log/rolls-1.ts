import { rollCommand } from "@server/features/dice-roll-log/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { DiceRollIntent } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";

/** Hidden-roll marker the leak scans look for (DICE §13). */
export const SECRET_LABEL = "DM-SECRET-ROLL";

/**
 * Four DM rolls (DICE §13), dice seeded per fixture key:
 * e1 Goblin attack "Scimitar" 1d20+4 → public (category on); e2 Goblin damage 1d6+2 with
 * `public: false` → hidden; e3 skill "Perception" 1d20+3 → hidden (category off);
 * e4 Mira initiative 1d20+2, manual 15 → public (DM roll for a PC, category on).
 */
export default defineFixture({
  key: "rolls-1",
  kind: "setup",
  requires: ["dice-settings", "char-mira", "enemy-1"],
  ownerSpec: "dice-roll-log",
  steps: [
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+4",
        category: "attack",
        label: "Scimitar",
        actor: { entityId: r.id("enemy-1", IMPORTED_ENTITY_TYPE) },
      }),
    ),
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d6+2",
        category: "damage",
        label: SECRET_LABEL,
        public: false,
        actor: { entityId: r.id("enemy-1", IMPORTED_ENTITY_TYPE) },
      }),
    ),
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+3",
        category: "skill-check",
        label: "Perception",
        actor: { entityId: r.id("enemy-1", IMPORTED_ENTITY_TYPE) },
      }),
    ),
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+2",
        category: "initiative",
        manual: { diceTotal: 15 },
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
      }),
    ),
  ],
});
