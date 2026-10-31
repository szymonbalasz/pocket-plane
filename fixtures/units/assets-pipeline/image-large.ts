import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";

/** `map-large` 6000 x 4000 → display the same (under 8192), thumb 512 x 341 (assets-pipeline §13). */
export default defineFixture({
  key: "image-large",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "assets-pipeline",
  assets: ["maps/map-large.svg"],
  steps: [ingestStep("maps/map-large.svg")],
});
