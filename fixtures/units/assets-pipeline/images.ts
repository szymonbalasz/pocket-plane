import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";

const FILES = [
  "maps/town.svg",
  "maps/battlemap.svg",
  "tokens/token-mira.svg",
  "tokens/token-goblin.svg",
  "tokens/token-wolf.svg",
  "tokens/token-elite.svg",
] as const;

/**
 * Fixture Campaign images (assets-pipeline §13): `town`, `battlemap` (1400 x 980 = 20 x 14 at
 * 70 px), tokens Mira blue, goblin green, wolf grey, elite dark green (256 x 256 round).
 * Asset IDs by index in the manifest: town 0, battlemap 1, mira 2, goblin 3, wolf 4, elite 5.
 */
export default defineFixture({
  key: "images",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "assets-pipeline",
  assets: FILES,
  steps: FILES.map((f) => ingestStep(f)),
});
