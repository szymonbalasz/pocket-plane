import { activateCampaign } from "@server/features/campaign-management/commands";
import { createEntity } from "@server/features/entities/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/** "Marsh Troll", custom in Second Campaign; Fixture Campaign stays active (ENT §13). */
export default defineFixture({
  key: "enemy-custom-second",
  kind: "setup",
  requires: ["campaign-second"],
  ownerSpec: "entities",
  steps: [
    step(activateCampaign, (r) => ({ id: r.id("campaign-second", "campaign") })),
    step(createEntity, {
      kind: "monster",
      name: "Marsh Troll",
      statBlock: {
        size: "large",
        ac: 15,
        hpMax: 59,
        initBonus: 1,
        speed: 30,
        attacks: [{ name: "Claw", toHit: 7, damage: "2d6+4", damageType: "slashing" }],
        cr: "5",
      },
    }),
    step(activateCampaign, (r) => ({ id: r.id("campaign", "campaign") })),
  ],
});
