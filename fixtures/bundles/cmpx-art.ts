import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Compendium-expansion X3 token art: `base` + the Town scene to place on + a small imported batch
 * with `artPath`s (`cmpx-art-batch`). Run with `PP_5ETOOLS_DIR` = a prepared `5etools-mini` folder.
 */
export default defineBundle({
  name: "cmpx-art",
  includes: ["base"],
  fixtures: ["town", "cmpx-art-batch"],
});
