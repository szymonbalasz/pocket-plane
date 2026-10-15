import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { activateScene, createScene, placeToken } from "@server/features/scenes-map/commands";
import { fog } from "../fog-of-war/commands";

/** Asset index in the `images` fixture (assets-pipeline §13). */
export const IMG = { town: 0, battlemap: 1, mira: 2, goblin: 3, wolf: 4, elite: 5 } as const;

/**
 * MAP §13 `town`: scene "Town", map `town`, 70 px grid, Mira at (5, 5) with `token-mira`. Active.
 * Revealed last (FR-FOG-25 ripple: new scenes start fogged).
 */
export default defineFixture({
  key: "town",
  kind: "setup",
  requires: ["images", "char-mira"],
  ownerSpec: "scenes-map",
  steps: [
    step(createScene, (r) => ({ name: "Town", mapAssetId: r.id("images", "asset", IMG.town) })),
    step(placeToken, (r) => ({
      sceneId: r.id("town", "scene"),
      definitionId: r.id("char-mira", "entity"),
      col: 5,
      row: 5,
      imageAssetId: r.id("images", "asset", IMG.mira),
    })),
    step(activateScene, (r) => ({ sceneId: r.id("town", "scene") })),
    step(fog.setAll, (r) => ({ sceneId: r.id("town", "scene"), fogged: false })),
  ],
});
