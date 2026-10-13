import { createEncounter } from "@server/features/combat-tracker/encounters";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";

/** CBT §13 `encounter-1`: planned "Ambush at the Ford": Goblin × 2, Wolf, Elite; party null. */
export default defineFixture({
  key: "encounter-1",
  kind: "setup",
  requires: ["enemy-1", "enemy-2", "enemy-custom"],
  ownerSpec: "combat-tracker",
  steps: [
    step(createEncounter, (r) => ({
      name: "Ambush at the Ford",
      partyCharacterIds: null,
      entries: [
        { definitionId: r.id("enemy-1", IMPORTED_ENTITY_TYPE), quantity: 2 },
        { definitionId: r.id("enemy-2", IMPORTED_ENTITY_TYPE), quantity: 1 },
        { definitionId: r.id("enemy-custom", ENTITY_TYPE), quantity: 1 },
      ],
    })),
  ],
});
