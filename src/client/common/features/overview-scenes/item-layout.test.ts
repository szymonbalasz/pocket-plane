// Overview item layout (OVW §13 unit): band order, label layout, miniature name, the box Fit reads.
import { describe, expect, test } from "bun:test";
import { LABEL_STYLE_DEFAULT, type LabelStyle } from "@shared/overview-scenes/schemas";
import {
  fontStack,
  fontsIn,
  itemBands,
  itemBox,
  labelLayout,
  MINIATURE_NAME_DEFAULT,
  miniatureLayout,
  type OverviewItemView,
} from "./item-layout";

const item = (over: Partial<OverviewItemView>): OverviewItemView => ({
  id: "i",
  campaignId: "c",
  overviewId: "o",
  seq: 1,
  z: 0,
  kind: "image",
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  hidden: false,
  assetId: "a",
  text: null,
  style: null,
  characterId: null,
  ownerPlayerId: null,
  shape: null,
  ...over,
});

const noDot: LabelStyle = {
  ...LABEL_STYLE_DEFAULT,
  dot: { ...LABEL_STYLE_DEFAULT.dot, on: false },
};
/** 10 units per character, whatever the font. */
const measure = (text: string) => text.length * 10;

describe("FR-OVW-19 bands", () => {
  test("FR-OVW-19 images < labels < miniatures, a later map below the party, then z, then seq", () => {
    const bands = itemBands([
      item({ id: "mini", kind: "miniature", seq: 1, z: 0 }),
      item({ id: "late-map", kind: "image", seq: 9, z: 5 }),
      item({ id: "label-b", kind: "label", seq: 3, z: 1 }),
      item({ id: "label-a", kind: "label", seq: 4, z: 0 }),
      item({ id: "map-1", kind: "image", seq: 2, z: 0 }),
      item({ id: "map-2", kind: "image", seq: 5, z: 0 }),
    ]);
    expect(bands.image.map((i) => i.id)).toEqual(["map-1", "map-2", "late-map"]);
    expect(bands.label.map((i) => i.id)).toEqual(["label-a", "label-b"]);
    expect(bands.miniature.map((i) => i.id)).toEqual(["mini"]);
  });
});

describe("FR-OVW-29 label layout", () => {
  test("FR-OVW-29 x, y = the dot's centre; the text right of it, vertically centred", () => {
    const l = labelLayout(LABEL_STYLE_DEFAULT, 100);
    expect(l.dotR).toBe(6);
    // Dot's outer edge 7, a quarter of the size 7, half the text stroke 1.
    expect(l.textX).toBe(15);
    expect(l.textY).toBe(-14);
    expect(l.box).toEqual({ x: -7, y: -15, w: 123, h: 30 });
  });

  test("FR-OVW-29 dot off: x, y = the text's left middle", () => {
    const l = labelLayout(noDot, 100);
    expect(l.dotR).toBeNull();
    expect(l.textX).toBe(0);
    expect(l.textY).toBe(-14);
    expect(l.box).toEqual({ x: -1, y: -15, w: 102, h: 30 });
  });

  test("FR-OVW-27 a dot taller than the text sets the box; stroke 0 adds nothing", () => {
    const big: LabelStyle = {
      ...LABEL_STYLE_DEFAULT,
      strokeWidth: 0,
      dot: { ...LABEL_STYLE_DEFAULT.dot, size: 100, strokeWidth: 0 },
    };
    const l = labelLayout(big, 10);
    expect(l.box.y).toBe(-50);
    expect(l.box.h).toBe(100);
    expect(l.textX).toBe(50 + 7);
  });

  test("FR-OVW-30 text and dot are in units: twice the size, twice the layout", () => {
    const twice: LabelStyle = {
      ...LABEL_STYLE_DEFAULT,
      size: 56,
      strokeWidth: 4,
      dot: { ...LABEL_STYLE_DEFAULT.dot, size: 24, strokeWidth: 4 },
    };
    const a = labelLayout(LABEL_STYLE_DEFAULT, 100);
    const b = labelLayout(twice, 200);
    expect(b.box.w).toBe(a.box.w * 2);
    expect(b.textX).toBe(a.textX * 2);
  });

  test("FR-OVW-30 the three fonts by family; only those in use load", () => {
    expect(fontStack("fell")).toContain("IM Fell English SC");
    expect(fontStack("garamond")).toContain("EB Garamond");
    expect(fontStack("alegreya")).toContain("Alegreya Sans");
    const fell = { ...LABEL_STYLE_DEFAULT, font: "fell" as const };
    expect(
      fontsIn([item({}), item({ kind: "label", style: fell }), item({ kind: "miniature" })]),
    ).toEqual(["fell", "garamond"]);
    expect(fontsIn([item({})])).toEqual([]);
  });
});

describe("FR-OVW-36 miniature name", () => {
  test("FR-OVW-36 under the miniature, centred; a wide name widens the box both ways", () => {
    const l = miniatureLayout(64, "Mira", MINIATURE_NAME_DEFAULT, 100);
    expect(l.nameY).toBeGreaterThan(64);
    expect(l.box.w).toBe(102);
    expect(l.box.x).toBe(-19);
    expect(l.box.y).toBe(0);
  });

  test("FR-OVW-32 no name: just the square", () => {
    expect(miniatureLayout(64, "", MINIATURE_NAME_DEFAULT, 0).box).toEqual({
      x: 0,
      y: 0,
      w: 64,
      h: 64,
    });
  });
});

describe("itemBox", () => {
  test("FR-OVW-23 an image's box is its x, y, w, h: nothing cropped", () => {
    expect(itemBox(item({ x: 10, y: 20, w: 300, h: 200 }), measure)).toEqual({
      x: 10,
      y: 20,
      w: 300,
      h: 200,
    });
  });

  test("a label's box follows its measured text; a miniature takes its side", () => {
    const label = item({ kind: "label", x: 100, y: 100, text: "Thundertree", w: null, h: null });
    const b = itemBox(label, measure);
    expect(b.x).toBe(93);
    expect(b.w).toBe(7 + 15 + 110 + 1);
    const mini = itemBox(item({ kind: "miniature", x: 5, y: 6, w: 32, h: 32 }), measure);
    expect(mini).toEqual({ x: 5, y: 6, w: 32, h: 32 });
  });
});
