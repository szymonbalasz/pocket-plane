import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { addDoor, addWalls } from "@server/features/scene-tools/structure";
import {
  type AddDoorInput,
  type AddWallsInput,
  DOOR_CLOSED,
  DOOR_LOCKED,
} from "@shared/scene-tools/schemas";

const scene = (r: Refs) => r.id("battlemap", "scene");

/**
 * SCN §13 `scn-walls`: Goblin Ambush structure. Walls at x = 8 for y 0–5, 6–11 and 12–14 (n 1–3);
 * door d1 (8, 5)–(8, 6) closed (n 4); door d2 (8, 11)–(8, 12) locked (n 5).
 */
export default defineFixture({
  key: "scn-walls",
  kind: "setup",
  requires: ["battlemap"],
  ownerSpec: "scene-tools",
  steps: [
    step(
      addWalls,
      (r): AddWallsInput => ({
        sceneId: scene(r),
        segments: [
          [8, 0, 8, 5],
          [8, 6, 8, 11],
          [8, 12, 8, 14],
        ],
      }),
    ),
    step(
      addDoor,
      (r): AddDoorInput => ({ sceneId: scene(r), segment: [8, 5, 8, 6], state: DOOR_CLOSED }),
    ),
    step(
      addDoor,
      (r): AddDoorInput => ({ sceneId: scene(r), segment: [8, 11, 8, 12], state: DOOR_LOCKED }),
    ),
  ],
});
