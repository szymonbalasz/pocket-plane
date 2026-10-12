import { createEntity } from "@server/features/entities/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { CreateEntityBody } from "@shared/entities/schemas";

/** Character "Thorn", owned by `player-2`: L1 rogue (ENT §13). */
export default defineFixture({
  key: "char-thorn",
  kind: "setup",
  requires: ["player-2"],
  ownerSpec: "entities",
  steps: [
    step(
      createEntity,
      (r): CreateEntityBody => ({
        kind: "character",
        name: "Thorn",
        ownerPlayerId: r.id("player-2", "player"),
        statBlock: {
          size: "medium",
          ac: 14,
          hpMax: 10,
          initBonus: 3,
          attacks: [{ name: "Dagger", toHit: 5, damage: "1d4+3", damageType: "piercing" }],
          level: 1,
          className: "Rogue",
        },
      }),
    ),
  ],
});
