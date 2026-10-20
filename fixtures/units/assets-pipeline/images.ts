import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";

const FILES = [
  "maps/town.svg",
  "maps/battlemap.svg",
  "tokens/token-mira.svg",
  "tokens/token-goblin.svg",
  "tokens/token-wolf.svg",
  "tokens/token-elite.svg",
  "tokens/token-thorn.svg",
] as const;

/**
 * Fixture Campaign images (assets-pipeline §13): `town`, `battlemap` (1400 x 980 = 20 x 14 at
 * 70 px), tokens (256 x 256 round), each its own silhouette and colour (G11): Mira blue fighter
 * (shield, sword), goblin green (big ears), wolf grey (wolf head), elite dark green (spiked
 * helmet, scimitar), Thorn purple rogue (hood, daggers).
 * Asset IDs by index in the manifest: town 0, battlemap 1, mira 2, goblin 3, wolf 4, elite 5,
 * thorn 6 (appended: earlier indexes and their seeded IDs unchanged).
 */
export default defineFixture({
  key: "images",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "assets-pipeline",
  assets: FILES,
  // *(S6)* Tags (FR-ASSET-41, ASSET §13.1): maps → Maps, token art → Tokens. IDs unchanged:
  // tags don't feed the seed.
  steps: FILES.map((f) => ingestStep(f, { tags: [f.startsWith("maps/") ? "Maps" : "Tokens"] })),
});
