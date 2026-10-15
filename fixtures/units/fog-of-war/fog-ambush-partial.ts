import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { FogEditInput } from "@shared/fog-of-war/schemas";
import { fog } from "./commands";

/**
 * FOG §13 `fog-ambush-partial`: reveal rect (0, 3)–(7, 11) (Mira, Thorn); reveal polygon
 * [(8, 9), (13, 9), (8, 14)] (Cave Ogre: its (10, 11) centre lies on the diagonal = inside).
 * Fogged: Goblin (12, 6), Goblin 2 (12, 8), Lurker; hidden + fogged: Wolf, Elite. Undo depth 3
 * (4 once the ripple's Reveal all lands, build/fog-visibility).
 */
export default defineFixture({
  key: "fog-ambush-partial",
  kind: "setup",
  requires: ["fog-ambush", "scenes-extras", "goblin-2"],
  ownerSpec: "fog-of-war",
  steps: [
    step(
      fog.edit,
      (r): FogEditInput => ({
        sceneId: r.id("battlemap", "scene"),
        op: "reveal",
        shape: { kind: "rect", c0: 0, r0: 3, c1: 7, r1: 11 },
      }),
    ),
    step(
      fog.edit,
      (r): FogEditInput => ({
        sceneId: r.id("battlemap", "scene"),
        op: "reveal",
        shape: {
          kind: "polygon",
          points: [
            [8, 9],
            [13, 9],
            [8, 14],
          ],
        },
      }),
    ),
  ],
});
