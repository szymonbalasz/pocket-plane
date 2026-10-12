import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { createScene, placeToken } from "@server/features/scenes-map/commands";
import { IMG } from "./town";

const scene = (r: Refs) => r.id("battlemap", "scene");

/**
 * MAP §13 `battlemap`: "Goblin Ambush", map `battlemap` (20 × 14 at 70 px), inactive. Mira (2, 7);
 * Goblin (12, 6); hidden: Wolf (14, 4), Elite Goblin Warrior (15, 8).
 */
export default defineFixture({
  key: "battlemap",
  kind: "setup",
  requires: ["town", "enemy-1", "enemy-2", "enemy-custom"],
  ownerSpec: "scenes-map",
  steps: [
    step(createScene, (r) => ({
      name: "Goblin Ambush",
      mapAssetId: r.id("images", "asset", IMG.battlemap),
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: r.id("char-mira", "entity"),
      col: 2,
      row: 7,
      imageAssetId: r.id("images", "asset", IMG.mira),
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: r.id("enemy-1", "imported-entity"),
      col: 12,
      row: 6,
      imageAssetId: r.id("images", "asset", IMG.goblin),
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: r.id("enemy-2", "imported-entity"),
      col: 14,
      row: 4,
      imageAssetId: r.id("images", "asset", IMG.wolf),
      hidden: true,
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: r.id("enemy-custom", "entity"),
      col: 15,
      row: 8,
      imageAssetId: r.id("images", "asset", IMG.elite),
      hidden: true,
    })),
  ],
});
