import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import { IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { IMG } from "../scenes-map/town";

/**
 * CBTX §13 `cbtx-reinforcement`: unbound tokens on Goblin Ambush after Start: "Goblin 3"
 * (`enemy-1`, visible, (14, 8)), "Wolf 2" (`enemy-2`, hidden, (15, 3)).
 */
export default defineFixture({
  key: "cbtx-reinforcement",
  kind: "setup",
  requires: ["combat-1"],
  ownerSpec: "combat-extras",
  steps: [
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: r.id("enemy-1", IMPORTED_ENTITY_TYPE),
      col: 14,
      row: 8,
      imageAssetId: r.id("images", "asset", IMG.goblin),
    })),
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: r.id("enemy-2", IMPORTED_ENTITY_TYPE),
      col: 15,
      row: 3,
      hidden: true,
      imageAssetId: r.id("images", "asset", IMG.wolf),
    })),
  ],
});
