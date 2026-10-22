import { saveMacro } from "@server/features/dice-extras/macros";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/** DICEX §13 `dicex-macros` names (tests and walkthrough T1 hard-code them). */
export const DICEX_MACROS = {
  sneak: "Sneak Attack",
  luck: "Luck",
  bless: "Bless",
  inspiration: "Inspiration",
  ambush: "Ambush",
} as const;

/**
 * Sprint 8 (FR-DICEX-64–67): player-1's Sneak Attack 3d6 damage on Mira and Luck 1d100 (general);
 * the DM's Bless 1d4 (DM only), Inspiration 1d8 on Thorn (player-2's by default, read-only to
 * them) and Ambush 2d6 on the Elite Goblin Warrior (DM only). Joins session-sim-12 (seams S15):
 * macros only, sim-11-safe.
 */
export default defineFixture({
  key: "dicex-macros",
  kind: "setup",
  requires: ["player-1", "player-2", "char-mira", "char-thorn", "enemy-custom"],
  ownerSpec: "dice-extras",
  steps: [
    step(
      saveMacro,
      (r) => ({
        name: DICEX_MACROS.sneak,
        expression: "3d6",
        category: "damage" as const,
        creatureId: r.id("char-mira", ENTITY_TYPE),
      }),
      { as: "player-1" },
    ),
    step(
      saveMacro,
      { name: DICEX_MACROS.luck, expression: "1d100", category: "other", creatureId: null },
      { as: "player-1" },
    ),
    step(saveMacro, {
      name: DICEX_MACROS.bless,
      expression: "1d4",
      category: "other" as const,
      creatureId: null,
    }),
    step(saveMacro, (r) => ({
      name: DICEX_MACROS.inspiration,
      expression: "1d8",
      category: "other" as const,
      creatureId: r.id("char-thorn", ENTITY_TYPE),
    })),
    step(saveMacro, (r) => ({
      name: DICEX_MACROS.ambush,
      expression: "2d6",
      category: "damage" as const,
      creatureId: r.id("enemy-custom", ENTITY_TYPE),
    })),
  ],
});
