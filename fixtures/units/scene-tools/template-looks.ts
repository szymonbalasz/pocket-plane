import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeTemplate } from "@server/features/scene-tools/templates";

const scene = (r: Refs) => r.id("battlemap", "scene");

/**
 * SCN §13 `template-looks` (FR-SCN-64, #466) on Goblin Ambush: a DM-placed kept **Mist** sphere
 * 20 ft at (10, 7) "Caustic smoke", tint `#7d8590`, cells 10 %; a `player-1` **Ground** cube 10 ft at
 * (4, 10) "Spike Growth" (own colour tint, default opacity).
 */
export default defineFixture({
  key: "template-looks",
  kind: "setup",
  requires: ["battlemap", "player-1"],
  ownerSpec: "scene-tools",
  steps: [
    step(placeTemplate, (r) => ({
      sceneId: scene(r),
      shape: "sphere" as const,
      x: 10,
      y: 7,
      size: 20,
      angle: 0,
      label: "Caustic smoke",
      look: "mist" as const,
      tint: "#7d8590",
      cellOpacity: 10,
    })),
    step(placeTemplate, (r) => ({
      sceneId: scene(r),
      shape: "cube" as const,
      x: 4,
      y: 10,
      size: 10,
      angle: 0,
      label: "Spike Growth",
      look: "ground" as const,
      placedByPlayerId: r.id("player-1", "player"),
    })),
  ],
});
