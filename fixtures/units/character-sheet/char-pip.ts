import { createEntity } from "@server/features/entities/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { CreateEntityBody } from "@shared/entities/schemas";

/**
 * Character "Pip", owned by `player-1`: L1 wizard with **no attack, no speed, no ability
 * scores** (CHAR §13): the sheet's "Speed —" and "No ability scores" states (FR-CHAR-18/19).
 */
export default defineFixture({
  key: "char-pip",
  kind: "setup",
  requires: ["player-1"],
  ownerSpec: "character-sheet",
  steps: [
    step(
      createEntity,
      (r): CreateEntityBody => ({
        kind: "character",
        name: "Pip",
        ownerPlayerId: r.id("player-1", "player"),
        statBlock: {
          size: "small",
          ac: 12,
          hpMax: 8,
          initBonus: 2,
          attacks: [],
          level: 1,
          className: "Wizard",
        },
      }),
    ),
  ],
});
