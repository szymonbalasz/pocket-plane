import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { moveTokenCommand } from "@server/features/scenes-map/commands";
import { tokenHooks } from "@server/features/scenes-map/token-hooks";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";

const moveToken = moveTokenCommand(tokenHooks);

/** The moves, in order: token ref → end cell (CBT §13.1 L1: Mira 2, Thorn 1, Goblin 1 segments). */
export const TRAIL_MOVES = [
  { who: "mira", from: [2, 7], to: [4, 7] },
  { who: "mira", from: [4, 7], to: [5, 6] },
  { who: "thorn", from: [2, 9], to: [4, 10] },
  { who: "goblin", from: [12, 6], to: [10, 6] },
] as const;

/** The stored trails the moves leave (FR-MAP-65): the start cell, then each move's end cell. */
export const TRAIL_CELLS = {
  mira: "2,7 4,7 5,6",
  thorn: "2,9 4,10",
  goblin: "12,6 10,6",
} as const;

const tokenRef = {
  mira: ["battlemap", 0],
  goblin: ["battlemap", 1],
  thorn: ["thorn-battlemap", 0],
};

/**
 * CBT §13.1 `trail-moves` (sprint 5, R3): this turn (round 1, Wolf's) the DM moves Mira twice,
 * Thorn and Goblin once on Goblin Ambush, so each token's stored `trail` holds this turn's cells
 * (FR-CBT-97, FR-MAP-65): DM sees three trails, players Mira's and Thorn's only (FR-MAP-66).
 */
export default defineFixture({
  key: "trail-moves",
  kind: "setup",
  requires: ["combat-1", "thorn-battlemap"],
  ownerSpec: "combat-tracker",
  steps: TRAIL_MOVES.map(({ who, to: [col, row] }) =>
    step(moveToken, (r) => {
      const [key, i] = tokenRef[who];
      return { tokenId: r.id(key as string, TOKEN_TYPE, i as number), col, row };
    }),
  ),
});
