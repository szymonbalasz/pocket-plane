import { createEncounter } from "@server/features/combat-tracker/encounters";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * CBT §13.1 `enc-friendly` (sprint 5, #252): planned "Escort to the Ford": Goblin ×2 (enemy) +
 * Goblin ×1 friendly (`side: ally`); party null.
 */
export default defineFixture({
  key: "enc-friendly",
  kind: "setup",
  requires: ["enemy-1"],
  ownerSpec: "combat-tracker",
  steps: [
    step(createEncounter, (r) => ({
      name: "Escort to the Ford",
      partyCharacterIds: null,
      entries: [
        { definitionId: r.id("enemy-1", IMPORTED_ENTITY_TYPE), quantity: 2 },
        { definitionId: r.id("enemy-1", IMPORTED_ENTITY_TYPE), quantity: 1, side: "ally" as const },
      ],
    })),
  ],
});
