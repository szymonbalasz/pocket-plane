import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeTemplate } from "@server/features/scene-tools/templates";

const scene = (r: Refs) => r.id("battlemap", "scene");

/**
 * SCN §13 (sprint 4) `mt-templates` on Goblin Ambush: **Thunderwave** kept cube 15 ft, freeform
 * origin (1.5, 10.5), angle 300, `placedByPlayerId: player-2` (DM override, FR-SCN-25; 8 golden
 * squares, FR-SCN-41); **Web** kept DM cube 20 ft at vertex (0, 6), angle 0 (mostly inside the
 * revealed nook, so players see it).
 */
export default defineFixture({
  key: "mt-templates",
  kind: "setup",
  requires: ["battlemap", "player-2"],
  ownerSpec: "scene-tools",
  steps: [
    step(placeTemplate, (r) => ({
      sceneId: scene(r),
      shape: "cube" as const,
      x: 1.5,
      y: 10.5,
      size: 15,
      angle: 300,
      label: "Thunderwave",
      placedByPlayerId: r.id("player-2", "player"),
    })),
    step(placeTemplate, (r) => ({
      sceneId: scene(r),
      shape: "cube" as const,
      x: 0,
      y: 6,
      size: 20,
      angle: 0,
      label: "Web",
    })),
  ],
});
