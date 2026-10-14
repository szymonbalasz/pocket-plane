import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * CBT §13 `thorn-battlemap`: Thorn token (owner `player-2`) on Goblin Ambush (2, 9), with
 * `token-thorn` (images index 6, G11).
 */
export default defineFixture({
  key: "thorn-battlemap",
  kind: "setup",
  requires: ["battlemap", "char-thorn"],
  ownerSpec: "combat-tracker",
  steps: [
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: r.id("char-thorn", ENTITY_TYPE),
      col: 2,
      row: 9,
      imageAssetId: r.id("images", "asset", 6), // token-thorn (G11)
    })),
  ],
});
