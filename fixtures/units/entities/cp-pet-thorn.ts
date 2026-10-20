import { createPet } from "@server/features/entities/pets";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * CBT §13.3 `cp-pet-thorn` (sprint 6, FR-ENT-32): `POST /api/pets` Wolf (`enemy-2`) for Thorn,
 * `in-owner-turn` → pet "Wolf" (11 / 11); its token beside Thorn on Goblin Ambush (3, 9), owned
 * by `player-2` (FR-MAP-74).
 */
export default defineFixture({
  key: "cp-pet-thorn",
  kind: "setup",
  requires: ["enemy-2", "char-thorn", "thorn-battlemap"],
  ownerSpec: "entities",
  steps: [
    step(createPet, (r) => ({
      baseDefinitionId: r.id("enemy-2", IMPORTED_ENTITY_TYPE),
      companionOf: r.id("char-thorn", ENTITY_TYPE),
      turnMode: "in-owner-turn" as const,
    })),
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: r.id("cp-pet-thorn", ENTITY_TYPE),
      col: 3,
      row: 9,
    })),
  ],
});
