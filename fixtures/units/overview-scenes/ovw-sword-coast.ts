import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { createOverview, showOverview } from "@server/features/overview-scenes/commands";
import {
  addParty,
  placeImage,
  placeLabel,
  updateItems,
} from "@server/features/overview-scenes/items";
import { LABEL_STYLE_DEFAULT, OVERVIEW_TYPE } from "@shared/overview-scenes/schemas";

/** Item index in `ovw-sword-coast`, in placement order. */
export const SWORD_COAST = {
  map: 0,
  neverwinter: 1,
  phandalin: 2,
  cragmaw: 3,
  scroll: 4,
  mira: 5,
  thorn: 6,
} as const;

const coast = (r: Refs) => r.id("ovw-sword-coast", OVERVIEW_TYPE);

const WHITE_RING = LABEL_STYLE_DEFAULT;
const GOLD_FELL = {
  ...LABEL_STYLE_DEFAULT,
  font: "fell",
  size: 48,
  color: "#f0c74a",
  dot: { ...LABEL_STYLE_DEFAULT.dot, size: 20, color: "#f0c74a" },
} as const;
const NO_DOT_ALEGREYA = {
  ...LABEL_STYLE_DEFAULT,
  font: "alegreya",
  size: 36,
  color: "#d9d9d9",
  strokeWidth: 0,
  dot: { ...LABEL_STYLE_DEFAULT.dot, on: false },
} as const;

/**
 * FR-OVW-46 `ovw-sword-coast`, **shown** (takes the active scene off): a locked map from
 * `map-large` (display 4096 × 2731), three styled labels (Cragmaw Castle hidden), a hidden scroll
 * and the party's miniatures (Mira: `player-1`, Thorn: `player-2`), off to the south-east so a press
 * on the middle of the map still lands on the map.
 */
export default defineFixture({
  key: "ovw-sword-coast",
  kind: "setup",
  requires: ["image-large", "char-mira", "char-thorn"],
  ownerSpec: "overview-scenes",
  assets: ["props/scroll.svg"],
  steps: [
    ingestStep("props/scroll.svg", { tags: ["Maps"] }),
    step(createOverview, { name: "Sword Coast" }),
    step(placeImage, (r) => ({
      overviewId: coast(r),
      assetId: r.id("image-large", "asset"),
      x: 0,
      y: 0,
      w: 4096,
      h: 2731,
    })),
    step(placeLabel, (r) => ({
      overviewId: coast(r),
      x: 1180,
      y: 860,
      text: "Neverwinter",
      style: GOLD_FELL,
    })),
    step(placeLabel, (r) => ({
      overviewId: coast(r),
      x: 1420,
      y: 1240,
      text: "Phandalin",
      style: WHITE_RING,
    })),
    step(placeLabel, (r) => ({
      overviewId: coast(r),
      x: 1640,
      y: 1010,
      text: "Cragmaw Castle",
      style: NO_DOT_ALEGREYA,
      hidden: true,
    })),
    step(placeImage, (r) => ({
      overviewId: coast(r),
      assetId: r.id("ovw-sword-coast", "asset"),
      x: 4160,
      y: 120,
      w: 256,
      h: 384,
      hidden: true,
    })),
    step(updateItems, (r) => ({
      overviewId: coast(r),
      items: [{ itemId: r.id("ovw-sword-coast", "overview-item", SWORD_COAST.map), locked: true }],
    })),
    step(addParty, (r) => ({ overviewId: coast(r), x: 3100, y: 2200, size: 160 })),
    step(showOverview, (r) => ({ overviewId: coast(r) })),
  ],
});
