import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { activateScene } from "@server/features/scenes-map/commands";
import { createMirror } from "@server/features/token-mirrors/commands";

/**
 * MIR §13 `mir-goblin`: Goblin Ambush live, and a Transparent mirror of **Goblin Sneak** (4, 9) at
 * (16, 11), the far side of the map: out of every player's sight (foggable, #443).
 */
export default defineFixture({
  key: "mir-goblin",
  kind: "setup",
  requires: ["battlemap", "mt-crowd"],
  ownerSpec: "token-mirrors",
  steps: [
    step(activateScene, (r) => ({ sceneId: r.id("battlemap", "scene") })),
    step(createMirror, (r) => ({
      tokenId: r.id("mt-crowd", "token", 0),
      col: 16,
      row: 11,
      mode: "transparent" as const,
    })),
  ],
});
