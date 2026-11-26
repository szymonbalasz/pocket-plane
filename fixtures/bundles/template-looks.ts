import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * SCN §13 `template-looks` (#466) = `scene-tools` (its `scn-templates` sphere and hidden cube have
 * no look: old-shape rows) + a kept DM Mist sphere and a `player-1` Ground cube.
 */
export default defineBundle({
  name: "template-looks",
  includes: ["scene-tools"],
  fixtures: ["template-looks"],
});
