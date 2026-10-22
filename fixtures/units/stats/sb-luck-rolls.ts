import { rollCommand } from "@server/features/dice-roll-log/commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import type { DiceRollIntent } from "@shared/dice-roll-log/schemas";

type Character = "char-mira" | "char-thorn";

/** A physical (manual) roll as `character`; `as` a player, else the DM. */
const d20 = (
  character: Character,
  manual: { diceTotal: number; dice?: number[] },
  o: Partial<Pick<DiceRollIntent, "category" | "label" | "mode" | "public">> & { as?: string } = {},
) => {
  const { as, ...rest } = o;
  return step(
    rollCommand,
    (r: Refs): DiceRollIntent => ({
      expression: "1d20+5",
      category: "attack",
      ...rest,
      actor: { entityId: r.id(character, "entity") },
      manual,
    }),
    as ? { as } : {},
  );
};

/**
 * STATS §13.1 `sb-luck-rolls` (joins session-sim-12, seams S15; session-sim-11-safe: rolls only,
 * no fight or combatant), physical dice only.
 * - Mira (Player 1): attack with advantage 18 / 3 (both faces count, no nat); an attack nat 20;
 *   an initiative nat 20 (never counted).
 * - Thorn (Player 2): a save nat 1; a death save nat 20.
 * - DM: a hidden roll as Thorn, nat 20 (the DM's view only); the DM's own public "Bandit" d20,
 *   nat 20 (DM dice; no actor, so no fight dependency).
 * - Player 1: a "Me" nat 20 (no character: counts nowhere).
 * Luck from this unit, DM | players: Mira rolls 2, d20s 3 (18, 3, 20), avg 13.7, nat 20s 1 |
 * same; Thorn rolls 3 | 2, nat 20s 2 | 1, nat 1s 1 | 1; DM dice rolls 1, nat 20s 1 | (none).
 */
export default defineFixture({
  key: "sb-luck-rolls",
  kind: "setup",
  requires: ["char-mira", "char-thorn", "player-1", "player-2"],
  ownerSpec: "stats",
  steps: [
    d20("char-mira", { diceTotal: 18, dice: [18, 3] }, { mode: "advantage", as: "player-1" }),
    d20("char-mira", { diceTotal: 20 }, { as: "player-1" }),
    d20("char-mira", { diceTotal: 20 }, { category: "initiative", as: "player-1" }),
    d20(
      "char-thorn",
      { diceTotal: 1 },
      { category: "saving-throw", label: "Dexterity save", as: "player-2" },
    ),
    d20(
      "char-thorn",
      { diceTotal: 20 },
      { category: "saving-throw", label: "Death save", as: "player-2" },
    ),
    d20("char-thorn", { diceTotal: 20 }, { public: false }),
    step(
      rollCommand,
      (): DiceRollIntent => ({
        expression: "1d20+3",
        category: "attack",
        label: "Bandit",
        manual: { diceTotal: 20 },
        public: true,
      }),
    ),
    step(
      rollCommand,
      (): DiceRollIntent => ({ expression: "1d20", category: "other", manual: { diceTotal: 20 } }),
      { as: "player-1" },
    ),
  ],
});
