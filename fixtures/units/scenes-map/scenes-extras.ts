import { createEntity } from "@server/features/entities/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import {
  createFolder,
  createScene,
  patchScene,
  placeToken,
  setGrid,
  setLocked,
} from "@server/features/scenes-map/commands";
import { wolf } from "../../srd/monster/wolf";

/**
 * MAP §13 `scenes-extras`: folder "Act 1" holding Town + Goblin Ambush; Thorn on both; custom
 * "Cave Ogre" (wolf block, large) on Goblin Ambush (9, 10), visible; root scene "Cellar"
 * (`map-large`, cell 50, offset 25/10, #ffffff 0.3, locked) with a Goblin at (40, 27).
 * Records: scene-folder 0; entity 0 = Cave Ogre; scene 0 = Cellar.
 */
export default defineFixture({
  key: "scenes-extras",
  kind: "setup",
  requires: ["battlemap", "char-thorn", "image-large"],
  ownerSpec: "scenes-map",
  steps: [
    step(createFolder, { name: "Act 1" }),
    step(patchScene, (r) => ({
      id: r.id("town", "scene"),
      folderId: r.id("scenes-extras", "scene-folder"),
    })),
    step(patchScene, (r) => ({
      id: r.id("battlemap", "scene"),
      folderId: r.id("scenes-extras", "scene-folder"),
    })),
    step(placeToken, (r) => ({
      sceneId: r.id("town", "scene"),
      definitionId: r.id("char-thorn", "entity"),
      col: 4,
      row: 5,
    })),
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: r.id("char-thorn", "entity"),
      col: 2,
      row: 9,
    })),
    step(createEntity, {
      kind: "monster",
      name: "Cave Ogre",
      statBlock: { ...wolf.statBlock, size: "large" },
    }),
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: r.id("scenes-extras", "entity"),
      col: 9,
      row: 10,
    })),
    step(createScene, (r) => ({ name: "Cellar", mapAssetId: r.id("image-large", "asset") })),
    step(setGrid, (r) => ({
      sceneId: r.id("scenes-extras", "scene"),
      cellSize: 50,
      offsetX: 25,
      offsetY: 10,
      visible: true,
      color: "#ffffff",
      opacity: 0.3,
    })),
    step(placeToken, (r) => ({
      sceneId: r.id("scenes-extras", "scene"),
      definitionId: r.id("enemy-1", "imported-entity"),
      col: 40,
      row: 27,
    })),
    step(setLocked, (r) => ({ sceneId: r.id("scenes-extras", "scene"), locked: true })),
  ],
});
