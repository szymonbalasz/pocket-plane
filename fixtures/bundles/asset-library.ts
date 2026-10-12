import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/** assets-pipeline §13, walkthrough A. */
export default defineBundle({
  name: "asset-library",
  includes: ["base"],
  fixtures: ["player-2", "campaign-second", "images", "image-large", "images-second"],
});
