import { createEntity } from "@server/features/entities/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { CreateEntityBody } from "@shared/entities/schemas";

/** Character "Mira", owned by `player-1`: L1 fighter (ENT §13). */
export default defineFixture({
  key: "char-mira",
  kind: "setup",
  requires: ["player-1"],
  ownerSpec: "entities",
  steps: [
    step(
      createEntity,
      (r): CreateEntityBody => ({
        kind: "character",
        name: "Mira",
        ownerPlayerId: r.id("player-1", "player"),
        statBlock: {
          size: "medium",
          ac: 16,
          hpMax: 12,
          initBonus: 2,
          attacks: [{ name: "Shortsword", toHit: 4, damage: "1d6+2", damageType: "piercing" }],
          level: 1,
          className: "Fighter",
        },
      }),
    ),
  ],
});
