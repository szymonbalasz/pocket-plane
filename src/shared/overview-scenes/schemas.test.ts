// OVW §13 unit level: input bounds, style zod, band order.
import { describe, expect, test } from "bun:test";
import {
  compareItems,
  GROUP_ACTION_MAX,
  IMAGE_SIDE,
  ItemIdsInput,
  LABEL_STYLE_DEFAULT,
  LABEL_TEXT_MAX,
  LabelStyle,
  LabelText,
  MiniatureStyle,
  MoveItemsInput,
  PlaceImageInput,
  PlaceLabelInput,
  PlayerOverviewItemRecord,
  PlayerOverviewRecord,
  POSITION_MAX,
  UpdateOverviewInput,
} from "./schemas";

const dot = LABEL_STYLE_DEFAULT.dot;
const style = (over: Record<string, unknown>) => ({ ...LABEL_STYLE_DEFAULT, ...over });
const withDot = (over: Record<string, unknown>) => style({ dot: { ...dot, ...over } });
const ok = (v: unknown) => LabelStyle.safeParse(v).success;

describe("FR-OVW-27 style bounds", () => {
  test("FR-OVW-27 style bounds: the default is valid and as the spec says", () => {
    expect(LabelStyle.parse(LABEL_STYLE_DEFAULT)).toEqual({
      font: "garamond",
      size: 28,
      color: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 2,
      dot: { on: true, size: 12, color: "#ffffff", strokeColor: "#000000", strokeWidth: 2 },
    });
  });

  test("FR-OVW-27 style bounds: fonts, size, colours, strokes and the dot", () => {
    for (const font of ["fell", "garamond", "alegreya"]) expect(ok(style({ font }))).toBe(true);
    expect(ok(style({ font: "comic" }))).toBe(false);
    for (const size of [8, 512]) expect(ok(style({ size }))).toBe(true);
    for (const size of [7.9, 512.1]) expect(ok(style({ size }))).toBe(false);
    for (const color of ["#fff", "white", "#gggggg", "#12345678"]) {
      expect(ok(style({ color }))).toBe(false);
      expect(ok(style({ strokeColor: color }))).toBe(false);
      expect(ok(withDot({ color }))).toBe(false);
      expect(ok(withDot({ strokeColor: color }))).toBe(false);
    }
    for (const strokeWidth of [0, 32]) {
      expect(ok(style({ strokeWidth }))).toBe(true);
      expect(ok(withDot({ strokeWidth }))).toBe(true);
    }
    for (const strokeWidth of [-1, 33]) {
      expect(ok(style({ strokeWidth }))).toBe(false);
      expect(ok(withDot({ strokeWidth }))).toBe(false);
    }
    for (const size of [2, 256]) expect(ok(withDot({ size }))).toBe(true);
    for (const size of [1.9, 257]) expect(ok(withDot({ size }))).toBe(false);
  });

  test("FR-OVW-27 style bounds: strict, every field required, colours stored lowercase", () => {
    expect(ok(style({ extra: 1 }))).toBe(false);
    expect(ok(withDot({ extra: 1 }))).toBe(false);
    const { font: _font, ...noFont } = LABEL_STYLE_DEFAULT;
    expect(ok(noFont)).toBe(false);
    expect(LabelStyle.parse(style({ color: "#ABCDEF" })).color).toBe("#abcdef");
  });

  test("FR-OVW-36 a miniature's name style has no dot", () => {
    const { dot: _dot, ...text } = LABEL_STYLE_DEFAULT;
    expect(MiniatureStyle.safeParse(text).success).toBe(true);
    expect(MiniatureStyle.safeParse(LABEL_STYLE_DEFAULT).success).toBe(false);
  });
});

describe("OVW input bounds", () => {
  const image = { overviewId: "o", assetId: "a", x: 0, y: 0, w: 100, h: 100 };

  test("FR-OVW-15 position: within ±16384, 2 decimals", () => {
    const at = (x: number, y = 0) => PlaceImageInput.safeParse({ ...image, x, y }).success;
    for (const v of [POSITION_MAX, -POSITION_MAX, 0, 12.34, -0.01]) expect(at(v)).toBe(true);
    for (const v of [POSITION_MAX + 0.01, -POSITION_MAX - 1, 1.234, Number.NaN, Infinity]) {
      expect(at(v)).toBe(false);
      expect(at(0, v)).toBe(false);
    }
  });

  test("FR-OVW-23 an image's side: 8–16384 units", () => {
    const side = (w: number, h = 100) => PlaceImageInput.safeParse({ ...image, w, h }).success;
    for (const v of [IMAGE_SIDE.min, IMAGE_SIDE.max]) expect(side(v)).toBe(true);
    for (const v of [IMAGE_SIDE.min - 0.01, IMAGE_SIDE.max + 1]) {
      expect(side(v)).toBe(false);
      expect(side(100, v)).toBe(false);
    }
  });

  test("FR-OVW-24 the server takes any shape: no ratio check", () => {
    expect(PlaceImageInput.safeParse({ ...image, w: 8, h: 16384 }).success).toBe(true);
  });

  test("FR-OVW-26 label text: clean, one line, trimmed, 1–80 code points", () => {
    expect(LabelText.parse("  Thundertree  ")).toBe("Thundertree");
    expect(LabelText.safeParse("a".repeat(LABEL_TEXT_MAX)).success).toBe(true);
    expect(LabelText.safeParse("😀".repeat(LABEL_TEXT_MAX)).success).toBe(true);
    for (const bad of ["", "   ", "a".repeat(LABEL_TEXT_MAX + 1), "two\nlines", "tab\there"]) {
      expect(LabelText.safeParse(bad).success).toBe(false);
    }
    const label = { overviewId: "o", x: 0, y: 0, style: LABEL_STYLE_DEFAULT };
    expect(PlaceLabelInput.safeParse({ ...label, text: "Conyberry" }).success).toBe(true);
    expect(PlaceLabelInput.safeParse({ ...label, text: "" }).success).toBe(false);
    expect(PlaceLabelInput.safeParse({ ...label, text: "x", style: undefined }).success).toBe(
      false,
    );
  });

  test("FR-OVW-17 group actions: 1–50 items, none twice", () => {
    const moves = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ itemId: `i${i}`, x: 0, y: 0 }));
    const parse = (m: unknown) => MoveItemsInput.safeParse({ overviewId: "o", moves: m }).success;
    expect(parse(moves(1))).toBe(true);
    expect(parse(moves(GROUP_ACTION_MAX))).toBe(true);
    expect(parse([])).toBe(false);
    expect(parse(moves(GROUP_ACTION_MAX + 1))).toBe(false);
    expect(parse([...moves(1), ...moves(1)])).toBe(false);
    expect(ItemIdsInput.safeParse({ overviewId: "o", itemIds: ["a", "a"] }).success).toBe(false);
  });

  test("FR-OVW-02 update: a folder or the root, strict", () => {
    const parse = (v: object) => UpdateOverviewInput.safeParse({ overviewId: "o", ...v }).success;
    expect(parse({ name: "Waterdeep" })).toBe(true);
    expect(parse({ folderId: null })).toBe(true);
    expect(parse({ active: true })).toBe(false);
    expect(parse({ name: "x".repeat(61) })).toBe(false);
  });
});

describe("FR-OVW-19 band order", () => {
  test("FR-OVW-19 images < labels < miniatures, then z, then seq", () => {
    const items = [
      { id: "mini", kind: "miniature", z: -5, seq: 1 },
      { id: "label2", kind: "label", z: 1, seq: 3 },
      { id: "late-map", kind: "image", z: 90, seq: 9 },
      { id: "label1", kind: "label", z: 1, seq: 2 },
      { id: "label0", kind: "label", z: 0, seq: 8 },
      { id: "map", kind: "image", z: 0, seq: 4 },
    ] as const;
    expect([...items].sort(compareItems).map((i) => i.id)).toEqual([
      "map",
      "late-map",
      "label0",
      "label1",
      "label2",
      "mini",
    ]);
  });
});

describe("FR-OVW-39 player records", () => {
  test("FR-OVW-39 strict: no name, folder, seq, lock or timestamps", () => {
    const o = { id: "o", campaignId: "c", active: true };
    expect(PlayerOverviewRecord.safeParse(o).success).toBe(true);
    for (const extra of [{ name: "n" }, { folderId: null }, { seq: 1 }]) {
      expect(PlayerOverviewRecord.safeParse({ ...o, ...extra }).success).toBe(false);
    }
    const item = {
      id: "i",
      campaignId: "c",
      overviewId: "o",
      seq: 1,
      z: 0,
      kind: "label",
      x: 0,
      y: 0,
      w: null,
      h: null,
      hidden: false,
      assetId: null,
      text: "t",
      style: LABEL_STYLE_DEFAULT,
      characterId: null,
      ownerPlayerId: null,
      shape: null,
    };
    expect(PlayerOverviewItemRecord.safeParse(item).success).toBe(true);
    for (const extra of [{ locked: false }, { createdAt: "x" }, { updatedAt: "x" }]) {
      expect(PlayerOverviewItemRecord.safeParse({ ...item, ...extra }).success).toBe(false);
    }
  });
});
