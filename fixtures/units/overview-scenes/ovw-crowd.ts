import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { createOverview } from "@server/features/overview-scenes/commands";
import { placeImage, placeLabel } from "@server/features/overview-scenes/items";
import { LABEL_STYLE_DEFAULT, OVERVIEW_TYPE } from "@shared/overview-scenes/schemas";
import { IMG } from "../scenes-map/town";

const crowd = (r: Refs) => r.id("ovw-crowd", OVERVIEW_TYPE);

/** Places on a 20 × 15 grid, labels first (spacing in units). */
const at = (i: number) => ({ x: (i % 20) * 240 - 2400, y: Math.floor(i / 20) * 180 - 1350 });

const IMAGES = [IMG.town, IMG.battlemap, IMG.goblin, IMG.wolf, IMG.elite] as const;

/**
 * FR-OVW-46 `ovw-crowd`, not shown: the feature's cap of 300 items, 200 stroked labels and 100
 * images (OVW §12: walkthrough step 12 only). Miniatures come with their slice.
 */
export default defineFixture({
  key: "ovw-crowd",
  kind: "setup",
  requires: ["images"],
  ownerSpec: "overview-scenes",
  steps: [
    step(createOverview, { name: "Crowded Coast" }),
    ...Array.from({ length: 200 }, (_, i) =>
      step(placeLabel, (r) => ({
        overviewId: crowd(r),
        ...at(i),
        text: `Place ${i + 1}`,
        style: LABEL_STYLE_DEFAULT,
      })),
    ),
    ...Array.from({ length: 100 }, (_, i) =>
      step(placeImage, (r) => ({
        overviewId: crowd(r),
        ...at(200 + i),
        assetId: r.id("images", "asset", IMAGES[i % IMAGES.length]),
        w: 160,
        h: 120,
      })),
    ),
  ],
});
