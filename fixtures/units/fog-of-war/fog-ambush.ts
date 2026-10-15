import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import { IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { IMG } from "../scenes-map/town";
import { fog } from "./commands";

/**
 * FOG §13 `fog-ambush`: Goblin Ambush fully fogged (`fog.setAll {fogged: true}`); token "Goblin
 * Lurker" (`enemy-1`) at (17, 11), visible flag (fogged). `battlemap` revealed it (FR-FOG-25).
 */
export default defineFixture({
  key: "fog-ambush",
  kind: "setup",
  requires: ["battlemap"],
  ownerSpec: "fog-of-war",
  steps: [
    step(fog.setAll, (r) => ({ sceneId: r.id("battlemap", "scene"), fogged: true })),
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: r.id("enemy-1", IMPORTED_ENTITY_TYPE),
      col: 17,
      row: 11,
      name: "Goblin Lurker",
      imageAssetId: r.id("images", "asset", IMG.goblin),
    })),
  ],
});
