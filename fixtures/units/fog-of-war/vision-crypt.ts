import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { addWalls } from "@server/features/scene-tools/structure";
import type { FogEditInput, FogPlaceDarknessInput } from "@shared/fog-of-war/schemas";
import type { AddWallsInput } from "@shared/scene-tools/schemas";
import { fog } from "./commands";

const scene = (r: Refs) => r.id("battlemap", "scene");

/**
 * FOG §13 `vision-crypt`, a patch on Goblin Ambush only (fully fogged by `fog-ambush`): the nook
 * revealed (rect [0, 6, 3, 11], snapped; Mira and Thorn stand in it); a free Explored polygon over
 * the north corridor [8.5, 0, 19.75, 0, 19.75, 4.5, 8.5, 4.5]; a magical darkness circle
 * [12.5, 9, 1.5] (Goblin 2 inside, Goblin outside); one freeform wall [4.5, 3.25, 6.75, 5.5];
 * Explored memory on. No token, sheet or other scene touched.
 */
export default defineFixture({
  key: "vision-crypt",
  kind: "setup",
  requires: ["fog-ambush", "scn-walls", "goblin-2"],
  ownerSpec: "fog-of-war",
  steps: [
    step(
      fog.edit,
      (r): FogEditInput => ({ sceneId: scene(r), op: "reveal", shape: { rect: [0, 6, 3, 11] } }),
    ),
    step(
      fog.edit,
      (r): FogEditInput => ({
        sceneId: scene(r),
        op: "explored",
        shape: { polygon: [8.5, 0, 19.75, 0, 19.75, 4.5, 8.5, 4.5] },
      }),
    ),
    step(
      fog.placeDarkness,
      (r): FogPlaceDarknessInput => ({ sceneId: scene(r), shape: { circle: [12.5, 9, 1.5] } }),
    ),
    step(
      addWalls,
      (r): AddWallsInput => ({ sceneId: scene(r), segments: [[4.5, 3.25, 6.75, 5.5]] }),
    ),
    step(fog.setExplored, (r) => ({ sceneId: scene(r), on: true })),
  ],
});
