import { createEntity } from "@server/features/entities/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { CreateEntityBody } from "@shared/entities/schemas";
import { goblin } from "../../srd/monster/goblin";

// FIX §8: no HP formula (only Average HP), unlike its SRD source (FR-ENT-25).
const { hpFormula: _hpFormula, ...goblinBlock } = goblin.statBlock;

/** "Elite Goblin Warrior", custom in Fixture Campaign, derived from `enemy-1` (ENT §13). */
export default defineFixture({
  key: "enemy-custom",
  kind: "setup",
  requires: ["campaign", "enemy-1"],
  ownerSpec: "entities",
  steps: [
    step(
      createEntity,
      (r): CreateEntityBody => ({
        kind: "monster",
        name: "Elite Goblin Warrior",
        derivedFromId: r.id("enemy-1", "imported-entity"),
        tokenShape: "square",
        statBlock: {
          ...goblinBlock,
          ac: 16,
          hpMax: 15,
          saveProficiencies: ["dex"],
          attacks: [{ name: "Scimitar", toHit: 5, damage: "1d6+3", damageType: "slashing" }],
          cr: "1/2",
        },
      }),
    ),
  ],
});
