import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** SCN §13 props slice: `scenes` + `scn-prop-images` + `scn-props` (Goblin Ambush prepped with props). */
export default defineBundle({
  name: "scene-tools-props",
  includes: ["scenes"],
  fixtures: ["scn-prop-images", "scn-props"],
});
