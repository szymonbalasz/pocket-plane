import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import { IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { IMG } from "../scenes-map/town";

/** CBT §13 `goblin-2`: token "Goblin 2" (`enemy-1`, token-goblin) on Goblin Ambush (12, 8). */
export default defineFixture({
  key: "goblin-2",
  kind: "setup",
  requires: ["battlemap"],
  ownerSpec: "combat-tracker",
  steps: [
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: r.id("enemy-1", IMPORTED_ENTITY_TYPE),
      col: 12,
      row: 8,
      imageAssetId: r.id("images", "asset", IMG.goblin),
    })),
  ],
});
