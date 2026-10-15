import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";

const FILES = ["props/prop-barrel.svg", "props/prop-table.svg", "props/prop-chest.svg"] as const;

/** Asset index in the `scn-prop-images` fixture (SCN §13). */
export const PROP_IMG = { barrel: 0, table: 1, chest: 2 } as const;

/**
 * SCN §13 `scn-prop-images`: committed SVGs `prop-barrel` (256 × 256, round), `prop-table`
 * (128 × 256, portrait: lies 2 × 1 at rotation 90), `prop-chest` (256 × 256), ingested.
 */
export default defineFixture({
  key: "scn-prop-images",
  kind: "setup",
  requires: ["images"],
  ownerSpec: "scene-tools",
  assets: FILES,
  steps: FILES.map((f) => ingestStep(f)),
});
