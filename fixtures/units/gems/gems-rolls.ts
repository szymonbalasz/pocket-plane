import { rollCommand } from "@server/features/dice-roll-log/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { DiceRollIntent } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/** GEM §13: the hidden roll's label, the leak scans' marker (FR-GEM-13). */
export const GEM_SECRET_LABEL = "DM-SECRET-GEM";

/** The lines' labels (tests and the e2e find them by label). */
export const GEMS_ROLLS = {
  perception: "Perception",
  stealth: "Stealth",
  initiative: "Initiative",
} as const;

/**
 * GEM §13 `gems-rolls` (GM1): Mira's d20 lines for the Inspiration reroll, physical so the totals
 * are fixed. `player-1`: e-perc "Perception" 1d20+3 = 4 + 3 = 7; e-adv "Stealth" 1d20+5 adv,
 * 6 / 2 → 11. DM: hidden Mira "DM-SECRET-GEM" 1d20+2 = 8 (`public: false`); Mira's initiative
 * (ineligible, FR-GEM-18). Death saves are ineligible too; sim-10's Mira isn't dying, so no
 * death-save line here (the integration test rolls one).
 */
export default defineFixture({
  key: "gems-rolls",
  kind: "setup",
  requires: ["char-mira"],
  ownerSpec: "gems",
  steps: [
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+3",
        category: "skill-check",
        label: GEMS_ROLLS.perception,
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
        manual: { diceTotal: 4 },
      }),
      { as: "player-1" },
    ),
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+5",
        mode: "advantage",
        category: "skill-check",
        label: GEMS_ROLLS.stealth,
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
        manual: { diceTotal: 6, dice: [6, 2] },
      }),
      { as: "player-1" },
    ),
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+2",
        category: "skill-check",
        label: GEM_SECRET_LABEL,
        public: false,
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
        manual: { diceTotal: 6 },
      }),
    ),
    step(
      rollCommand,
      (r): DiceRollIntent => ({
        expression: "1d20+3",
        category: "initiative",
        label: GEMS_ROLLS.initiative,
        actor: { entityId: r.id("char-mira", ENTITY_TYPE) },
        manual: { diceTotal: 12 },
      }),
    ),
  ],
});
