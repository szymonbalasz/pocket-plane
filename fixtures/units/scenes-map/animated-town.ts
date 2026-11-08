import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";

/** ANIM §13: the token names and cells tests hard-code. */
export const ANIMATED_TOWN = {
  /** Visible to players. */
  shown: { name: "Wisp", col: 7, row: 5 },
  /** Hidden from players: they never get its image ID (no `/motion` request). */
  hidden: { name: "Lurker", col: 10, row: 5 },
} as const;

/**
 * ANIM §13 `animated-town`: on Town (active, revealed), two Goblins with the `animated-token`
 * art: "Wisp" visible at (7, 5), "Lurker" hidden at (10, 5).
 */
export default defineFixture({
  key: "animated-town",
  kind: "setup",
  requires: ["town", "enemy-1", "animated-token"],
  ownerSpec: "animated-tokens",
  steps: [
    step(placeToken, (r) => ({
      sceneId: r.id("town", "scene"),
      definitionId: r.id("enemy-1", "imported-entity"),
      name: ANIMATED_TOWN.shown.name,
      col: ANIMATED_TOWN.shown.col,
      row: ANIMATED_TOWN.shown.row,
      imageAssetId: r.id("animated-token", "asset", 0),
    })),
    step(placeToken, (r) => ({
      sceneId: r.id("town", "scene"),
      definitionId: r.id("enemy-1", "imported-entity"),
      name: ANIMATED_TOWN.hidden.name,
      col: ANIMATED_TOWN.hidden.col,
      row: ANIMATED_TOWN.hidden.row,
      imageAssetId: r.id("animated-token", "asset", 0),
      hidden: true,
    })),
  ],
});
