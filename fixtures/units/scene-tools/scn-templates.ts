import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeTemplate } from "@server/features/scene-tools/templates";

const scene = (r: Refs) => r.id("battlemap", "scene");

/**
 * SCN §13 `scn-templates` on Goblin Ambush: kept sphere 15 ft at vertex (3, 8) "Spirit Guardians",
 * `placedByPlayerId: player-1` (DM override, FR-SCN-25); **hidden** DM cube 10 ft at (12, 12)
 * "Glyph".
 */
export default defineFixture({
  key: "scn-templates",
  kind: "setup",
  requires: ["battlemap", "player-1"],
  ownerSpec: "scene-tools",
  steps: [
    step(placeTemplate, (r) => ({
      sceneId: scene(r),
      shape: "sphere" as const,
      x: 3,
      y: 8,
      size: 15,
      angle: 0,
      label: "Spirit Guardians",
      placedByPlayerId: r.id("player-1", "player"),
    })),
    step(placeTemplate, (r) => ({
      sceneId: scene(r),
      shape: "cube" as const,
      x: 12,
      y: 12,
      size: 10,
      angle: 0,
      label: "Glyph",
      hidden: true,
    })),
  ],
});
