import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** FOG §13 `fog-scn` = `fog` + SCN's units + `fog-scn` (walkthrough step 11). */
export default defineBundle({
  name: "fog-scn",
  includes: ["fog"],
  fixtures: ["scn-prop-images", "scn-props", "scn-templates", "fog-scn"],
});
