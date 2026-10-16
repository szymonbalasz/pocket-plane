import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";

const FILES = ["handouts/thieves-map.svg", "handouts/wanted-poster.svg"] as const;

/** Asset index in the `handout-images` fixture (PARTY §13). */
export const HANDOUT_IMG = { thievesMap: 0, wantedPoster: 1 } as const;

/**
 * PARTY §13 `handout-images`: committed SVGs `thieves-map` (640 × 480 parchment street map) and
 * `wanted-poster` (400 × 560), ingested; used by no scene or token. `wanted-poster` stays unused
 * by any handout (walkthrough step 3).
 */
export default defineFixture({
  key: "handout-images",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "party-board",
  assets: FILES,
  steps: FILES.map((f) => ingestStep(f)),
});
