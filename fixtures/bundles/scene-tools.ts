import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * SCN §13 `scene-tools` = `scenes` + the SCN units. build/scene-tools-structure: `scn-walls`;
 * the props and templates slices append `scn-prop-images`, `scn-props`, `scn-templates`.
 */
export default defineBundle({
  name: "scene-tools",
  includes: ["scenes"],
  fixtures: ["scn-walls"],
});
