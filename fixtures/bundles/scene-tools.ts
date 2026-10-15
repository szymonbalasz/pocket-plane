import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * SCN §13 `scene-tools` = `scenes` + the SCN units. Each scene-tools slice adds its own units
 * (`scn-walls`, `scn-prop-images`, `scn-props` with structure / props); templates:
 * `scn-templates`.
 */
export default defineBundle({
  name: "scene-tools",
  includes: ["scenes"],
  fixtures: ["scn-prop-images", "scn-props", "scn-templates"],
});
