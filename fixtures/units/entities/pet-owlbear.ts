import { createPet } from "@server/features/entities/pets";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * CBT §13.3 `pet-owlbear` (sprint 6, FR-ENT-32): `POST /api/pets` Owlbear (`cp-srd`) for Mira,
 * `after-owner` → pet "Owlbear" (59 / 59); its token on Goblin Ambush beside Mira (0, 7), owned
 * by `player-1` (FR-MAP-74). CP1 appends `pet.adjustHp −14` (→ 45 / 59) with FR-ENT-36.
 */
export default defineFixture({
  key: "pet-owlbear",
  kind: "setup",
  requires: ["cp-srd", "char-mira", "battlemap"],
  ownerSpec: "entities",
  steps: [
    step(createPet, (r) => ({
      baseDefinitionId: r.id("cp-srd", IMPORTED_ENTITY_TYPE, 0),
      companionOf: r.id("char-mira", ENTITY_TYPE),
    })),
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: r.id("pet-owlbear", ENTITY_TYPE),
      col: 0,
      row: 7,
    })),
  ],
});
