import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";

const scene = (r: Refs) => r.id("battlemap", "scene");

/**
 * MAP §13 (sprint 4) `mt-crowd` on Goblin Ambush, visible, not combatants: **Goblin Sneak**
 * (`enemy-1`'s definition, name override) at (4, 9), **Goblin Sneak 2** at (5, 9) (numbered by
 * FR-MAP-16), **Crypt Ogre** (a second token of `scenes-extras`' Cave Ogre, large) at (4, 10).
 * Records: token 0–2 in that order.
 */
export default defineFixture({
  key: "mt-crowd",
  kind: "setup",
  requires: ["battlemap", "enemy-1", "scenes-extras"],
  ownerSpec: "scenes-map",
  steps: [
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: r.id("enemy-1", "imported-entity"),
      col: 4,
      row: 9,
      name: "Goblin Sneak",
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: r.id("enemy-1", "imported-entity"),
      col: 5,
      row: 9,
      name: "Goblin Sneak",
    })),
    step(placeToken, (r) => ({
      sceneId: scene(r),
      definitionId: r.id("scenes-extras", "entity"),
      col: 4,
      row: 10,
      name: "Crypt Ogre",
    })),
  ],
});
