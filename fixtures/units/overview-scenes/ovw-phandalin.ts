import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { createOverview } from "@server/features/overview-scenes/commands";
import { placeImage } from "@server/features/overview-scenes/items";
import { OVERVIEW_TYPE } from "@shared/overview-scenes/schemas";
import { IMG } from "../scenes-map/town";

/** FR-OVW-46 `ovw-phandalin`, not shown: `town` (display 2100 × 1400) as its only item. */
export default defineFixture({
  key: "ovw-phandalin",
  kind: "setup",
  requires: ["images"],
  ownerSpec: "overview-scenes",
  steps: [
    step(createOverview, { name: "Phandalin" }),
    step(placeImage, (r) => ({
      overviewId: r.id("ovw-phandalin", OVERVIEW_TYPE),
      assetId: r.id("images", "asset", IMG.town),
      x: 0,
      y: 0,
      w: 2100,
      h: 1400,
    })),
  ],
});
