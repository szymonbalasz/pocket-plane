import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeProp, updateProp } from "@server/features/scene-tools/props";
import { SCENE_PROP_TYPE } from "@shared/scene-tools/schemas";
import { PROP_IMG } from "./scn-prop-images";

const scene = (r: Refs) => r.id("battlemap", "scene");
const img = (r: Refs, i: number) => r.id("scn-prop-images", "asset", i);

/**
 * SCN §13 `scn-props` on Goblin Ambush: barrel (5, 3) 1 × 1; table (4, 11) 2 × 1, rotation 90;
 * **hidden** chest (17, 12) 1 × 1.
 */
export default defineFixture({
  key: "scn-props",
  kind: "setup",
  requires: ["scn-prop-images", "battlemap"],
  ownerSpec: "scene-tools",
  steps: [
    step(placeProp, (r) => ({
      sceneId: scene(r),
      assetId: img(r, PROP_IMG.barrel),
      col: 5,
      row: 3,
    })),
    step(placeProp, (r) => ({
      sceneId: scene(r),
      assetId: img(r, PROP_IMG.table),
      col: 4,
      row: 11,
      w: 2,
      h: 1,
    })),
    step(updateProp, (r) => ({
      propId: r.id("scn-props", SCENE_PROP_TYPE, 1),
      rotation: 90 as const,
    })),
    step(placeProp, (r) => ({
      sceneId: scene(r),
      assetId: img(r, PROP_IMG.chest),
      col: 17,
      row: 12,
      hidden: true,
    })),
  ],
});
