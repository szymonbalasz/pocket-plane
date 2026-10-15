import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeProp } from "@server/features/scene-tools/props";
import { addDoor } from "@server/features/scene-tools/structure";
import { placeTemplate } from "@server/features/scene-tools/templates";
import { type AddDoorInput, DOOR_CLOSED } from "@shared/scene-tools/schemas";
import { PROP_IMG } from "../scene-tools/scn-prop-images";

const scene = (r: Refs) => r.id("battlemap", "scene");

/**
 * FOG §13 `fog-scn`, in fog on Goblin Ambush: a visible barrel prop at (16, 2); a DM kept
 * template "Trap" (sphere 10 ft at vertex (18, 5)); a closed door on (15, 13)–(16, 13) (both
 * adjoining cells (15, 12), (15, 13) fogged → `f = 1`, FR-SCN-36). Records: scene-prop 0 =
 * barrel, aoe-template 0 = Trap.
 */
export default defineFixture({
  key: "fog-scn",
  kind: "setup",
  requires: ["fog-ambush-partial", "scn-walls", "scn-props", "scn-templates"],
  ownerSpec: "fog-of-war",
  steps: [
    step(placeProp, (r) => ({
      sceneId: scene(r),
      assetId: r.id("scn-prop-images", "asset", PROP_IMG.barrel),
      col: 16,
      row: 2,
    })),
    step(placeTemplate, (r) => ({
      sceneId: scene(r),
      shape: "sphere" as const,
      x: 18,
      y: 5,
      size: 10,
      angle: 0,
      label: "Trap",
    })),
    step(
      addDoor,
      (r): AddDoorInput => ({ sceneId: scene(r), segment: [15, 13, 16, 13], state: DOOR_CLOSED }),
    ),
  ],
});
