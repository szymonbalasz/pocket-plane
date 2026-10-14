import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * MAP §13 `thorn-town` (G1, #171): Thorn token (owner `player-2`, from the character) on Town
 * (4, 5), visible, with `token-thorn` (images index 6, G11). For `session-sim` only; `scenes-extras` keeps its own Thorn placements.
 */
export default defineFixture({
  key: "thorn-town",
  kind: "setup",
  requires: ["town", "char-thorn"],
  ownerSpec: "scenes-map",
  steps: [
    step(placeToken, (r) => ({
      sceneId: r.id("town", "scene"),
      definitionId: r.id("char-thorn", ENTITY_TYPE),
      col: 4,
      row: 5,
      imageAssetId: r.id("images", "asset", 6), // token-thorn (G11)
    })),
  ],
});
