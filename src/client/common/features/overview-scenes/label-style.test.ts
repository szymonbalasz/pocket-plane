// FR-OVW-27, -28: the client's style bounds, the last style, one commit, a mixed selection.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  DOT_SIZE,
  FONT_SIZE,
  GROUP_ACTION_MAX,
  LABEL_STYLE_DEFAULT,
  LabelStyle,
  OVW_INTENTS,
  STROKE_WIDTH_MAX,
  UpdateItemsInput,
} from "@shared/overview-scenes/schemas";
import { toast } from "sonner";
import { itemBox, type OverviewItemView } from "./item-layout";
import {
  lastLabelStyle,
  loadLabelStyle,
  mixedDotStyle,
  mixedTextStyle,
  patchedStyleOf,
  patchLabelStyle,
  previewStyle,
  rememberLabelStyle,
  restyleItems,
  STYLE_BOUNDS,
  saveLabelStyle,
  styleNumber,
  useLastLabelStyle,
  useStylePreview,
  withStylePreview,
} from "./label-style";

const label = (id: string, style: LabelStyle = LABEL_STYLE_DEFAULT): OverviewItemView => ({
  id,
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
  text: "Thundertree",
  style,
  characterId: null,
  ownerPlayerId: null,
  shape: null,
  locked: false,
});

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => m.set(k, v),
  };
};

const sent = () => mock((_: string, _i: unknown) => Promise.resolve());

beforeEach(() => {
  useStylePreview.setState({ preview: null });
  useLastLabelStyle.setState({ byCampaign: {} });
});

describe("FR-OVW-27 style bounds", () => {
  test("FR-OVW-27 style bounds: the controls take the schema's", () => {
    expect(STYLE_BOUNDS.size).toEqual(FONT_SIZE);
    expect(STYLE_BOUNDS.dotSize).toEqual(DOT_SIZE);
    expect(STYLE_BOUNDS.strokeWidth).toEqual({ min: 0, max: STROKE_WIDTH_MAX });
  });

  test("FR-OVW-27 style bounds: a typed number lands inside them, whole; junk is no number", () => {
    expect(styleNumber("600", FONT_SIZE)).toBe(512);
    expect(styleNumber("3", FONT_SIZE)).toBe(8);
    expect(styleNumber(" 27.6 ", FONT_SIZE)).toBe(28);
    expect(styleNumber("-1", STYLE_BOUNDS.strokeWidth)).toBe(0);
    expect(styleNumber("40", STYLE_BOUNDS.strokeWidth)).toBe(32);
    expect(styleNumber("1", DOT_SIZE)).toBe(2);
    expect(styleNumber("", FONT_SIZE)).toBeNull();
    expect(styleNumber("abc", FONT_SIZE)).toBeNull();
    expect(styleNumber("Infinity", FONT_SIZE)).toBeNull();
  });

  test("FR-OVW-27 style bounds: every bound reached that way passes the strict schema", () => {
    for (const size of [FONT_SIZE.min, FONT_SIZE.max]) {
      for (const strokeWidth of [0, STROKE_WIDTH_MAX]) {
        for (const dotSize of [DOT_SIZE.min, DOT_SIZE.max]) {
          const style = patchLabelStyle(LABEL_STYLE_DEFAULT, {
            size,
            strokeWidth,
            dot: { size: dotSize, strokeWidth, on: false },
          });
          expect(LabelStyle.safeParse(style).success).toBe(true);
        }
      }
    }
  });

  test("FR-OVW-27 first ever: the default, Garamond 28, white on a 2-unit black stroke, dot on", () => {
    expect(loadLabelStyle("new", memory())).toEqual(LABEL_STYLE_DEFAULT);
    expect(lastLabelStyle("new")).toEqual(LABEL_STYLE_DEFAULT);
  });
});

describe("FR-OVW-28 last style", () => {
  test("FR-OVW-28 last style: per campaign; junk or a style out of bounds is the default", () => {
    const store = memory();
    const fell = patchLabelStyle(LABEL_STYLE_DEFAULT, { font: "fell", size: 40 });
    saveLabelStyle("c1", fell, store);
    expect(loadLabelStyle("c1", store)).toEqual(fell);
    expect(loadLabelStyle("c2", store)).toEqual(LABEL_STYLE_DEFAULT);
    store.setItem("pp.overview.v1.label-style.c3", "{not json");
    expect(loadLabelStyle("c3", store)).toEqual(LABEL_STYLE_DEFAULT);
    store.setItem(
      "pp.overview.v1.label-style.c4",
      JSON.stringify({ ...LABEL_STYLE_DEFAULT, size: 9000 }),
    );
    expect(loadLabelStyle("c4", store)).toEqual(LABEL_STYLE_DEFAULT);
  });

  test("FR-OVW-28 last style: storage that throws still holds for this page", () => {
    const blocked = {
      getItem(): string | null {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(loadLabelStyle("c1", blocked)).toEqual(LABEL_STYLE_DEFAULT);
    expect(() => saveLabelStyle("c1", LABEL_STYLE_DEFAULT, blocked)).not.toThrow();
    rememberLabelStyle("c1", { font: "alegreya" });
    expect(lastLabelStyle("c1").font).toBe("alegreya");
  });

  test("FR-OVW-28 last style: a change carries over field by field, per campaign", () => {
    rememberLabelStyle("c1", { font: "fell" });
    rememberLabelStyle("c1", { dot: { color: "#ff0000" } });
    const style = lastLabelStyle("c1");
    expect(style.font).toBe("fell");
    expect(style.dot.color).toBe("#ff0000");
    expect(style.dot.strokeColor).toBe(LABEL_STYLE_DEFAULT.dot.strokeColor);
    expect(lastLabelStyle("c2")).toEqual(LABEL_STYLE_DEFAULT);
  });
});

describe("FR-OVW-28 restyling", () => {
  const realError = toast.error;
  afterEach(() => {
    toast.error = realError;
  });

  test("FR-OVW-28 one commit: previews send nothing, the release sends one intent", async () => {
    const send = sent();
    const items = [label("a"), label("b")];
    const ids = items.map((i) => i.id);
    for (let size = 30; size < 90; size++) previewStyle(ids, { size });
    expect(send).not.toHaveBeenCalled();
    expect(useStylePreview.getState().preview?.patch).toEqual({ size: 89 });
    await restyleItems(send, items, { size: 90 });
    expect(send).toHaveBeenCalledTimes(1);
    const [name, input] = send.mock.lastCall as [string, { items: { style: LabelStyle }[] }];
    expect(name).toBe(OVW_INTENTS.updateItems);
    expect(input.items.map((i) => i.style.size)).toEqual([90, 90]);
    expect(UpdateItemsInput.safeParse(input).success).toBe(true);
    expect(useStylePreview.getState().preview).toBeNull();
  });

  test("FR-OVW-28 one commit: the preview stays until the ack; a reject drops it and rethrows", async () => {
    let settle: (v?: unknown) => void = () => {};
    let fail: (e: unknown) => void = () => {};
    const send = mock(
      () =>
        new Promise((yes, no) => {
          settle = yes;
          fail = no;
        }),
    );
    const held = restyleItems(send, [label("a")], { size: 90 });
    expect(useStylePreview.getState().preview?.patch).toEqual({ size: 90 });
    settle();
    await held;
    expect(useStylePreview.getState().preview).toBeNull();

    const failed = restyleItems(send, [label("a")], { size: 91 });
    fail(new Error("no"));
    await expect(failed).rejects.toThrow("no");
    expect(useStylePreview.getState().preview).toBeNull();
  });

  test("FR-OVW-28 one commit: a newer preview survives an older commit's ack", async () => {
    let settle: (v?: unknown) => void = () => {};
    const send = mock(() => new Promise((yes) => (settle = yes)));
    const held = restyleItems(send, [label("a")], { size: 90 });
    previewStyle(["a"], { strokeWidth: 5 });
    settle();
    await held;
    expect(useStylePreview.getState().preview?.patch).toEqual({ strokeWidth: 5 });
  });

  test("FR-OVW-28 a quick second change carries the first, not yet back from the server", async () => {
    const acks: (() => void)[] = [];
    const send = mock(
      (_: string, _i: unknown) => new Promise<void>((yes) => acks.push(() => yes())),
    );
    const item = label("a");
    const first = restyleItems(send, [item], { dot: { color: "#ff0000" } });
    const second = restyleItems(send, [item], { font: "fell" });
    const input = send.mock.lastCall?.[1] as { items: { style: LabelStyle }[] };
    expect(input.items[0]?.style.font).toBe("fell");
    expect(input.items[0]?.style.dot.color).toBe("#ff0000");
    for (const ack of acks) ack();
    await Promise.all([first, second]);

    // Settled: the record is the base again.
    const third = restyleItems(send, [item], { size: 40 });
    acks.at(-1)?.();
    await third;
    const last = send.mock.lastCall?.[1] as { items: { style: LabelStyle }[] };
    expect(last.items[0]?.style.dot.color).toBe(LABEL_STYLE_DEFAULT.dot.color);
  });

  test("FR-OVW-28 mixed selection: a differing field shows mixed, a shared one its value", () => {
    const a = LABEL_STYLE_DEFAULT;
    const b = patchLabelStyle(a, { font: "fell", dot: { color: "#ff0000" } });
    const text = mixedTextStyle([a, b]);
    expect(text.font).toBeNull();
    expect(text.size).toBe(a.size);
    const dot = mixedDotStyle([a, b]);
    expect(dot.color).toBeNull();
    expect(dot.on).toBe(true);
    expect(dot.size).toBe(a.dot.size);
    expect(mixedTextStyle([b]).font).toBe("fell");
    // A stroke of 0 or a dot off is a value, not "mixed".
    const off = patchLabelStyle(a, { strokeWidth: 0, dot: { on: false } });
    expect(mixedTextStyle([off, off]).strokeWidth).toBe(0);
    expect(mixedDotStyle([off, off]).on).toBe(false);
  });

  test("FR-OVW-28 mixed selection: a change applies only the changed field to each", async () => {
    const send = sent();
    const big = patchLabelStyle(LABEL_STYLE_DEFAULT, { size: 60, color: "#123456" });
    const red = patchLabelStyle(LABEL_STYLE_DEFAULT, { font: "alegreya", dot: { on: false } });
    await restyleItems(send, [label("a", big), label("b", red)], { font: "fell" });
    const input = send.mock.lastCall?.[1] as {
      items: { itemId: string; style: LabelStyle }[];
    };
    expect(input.items).toEqual([
      { itemId: "a", style: { ...big, font: "fell" } },
      { itemId: "b", style: { ...red, font: "fell" } },
    ]);
  });

  test("FR-OVW-28 mixed selection: only items that change are sent; none change, nothing sent", async () => {
    const send = sent();
    const fell = patchLabelStyle(LABEL_STYLE_DEFAULT, { font: "fell" });
    await restyleItems(send, [label("a", fell), label("b")], { font: "fell" });
    const input = send.mock.lastCall?.[1] as { items: { itemId: string }[] };
    expect(input.items.map((i) => i.itemId)).toEqual(["b"]);

    const none = sent();
    await restyleItems(none, [label("a", fell)], { font: "fell" });
    expect(none).not.toHaveBeenCalled();
    expect(useStylePreview.getState().preview).toBeNull();
  });

  test("FR-OVW-28 mixed selection: more than 50 are refused with a toast, nothing sent", async () => {
    const toasted = mock((_: string) => "");
    toast.error = toasted as unknown as typeof toast.error;
    const send = sent();
    const many = Array.from({ length: GROUP_ACTION_MAX + 1 }, (_, i) => label(`l${i}`));
    await restyleItems(send, many, { font: "fell" });
    expect(send).not.toHaveBeenCalled();
    expect(toasted).toHaveBeenCalledTimes(1);
    expect(useStylePreview.getState().preview).toBeNull();
  });

  test("FR-OVW-28 a preview draws only its items, and the outline grows with it", () => {
    const item = label("a");
    const other = label("b");
    const preview = { ids: ["a"], patch: { size: 100, dot: { on: false } } };
    expect(withStylePreview(other, preview)).toBe(other);
    const drawn = withStylePreview(item, preview);
    expect(drawn.style).toEqual(patchLabelStyle(LABEL_STYLE_DEFAULT, preview.patch));
    const measure = () => 100;
    expect(itemBox(drawn, measure).h).toBeGreaterThan(itemBox(item, measure).h);
  });

  test("FR-OVW-36 a miniature's name takes the text fields and never a dot", async () => {
    const mini: OverviewItemView = { ...label("m"), kind: "miniature", style: null };
    expect(patchedStyleOf(mini, { font: "fell", dot: { on: false } })).toEqual({
      font: "fell",
      size: 14,
      color: LABEL_STYLE_DEFAULT.color,
      strokeColor: LABEL_STYLE_DEFAULT.strokeColor,
      strokeWidth: LABEL_STYLE_DEFAULT.strokeWidth,
    });
    const send = sent();
    await restyleItems(send, [mini], { size: 20 });
    const input = send.mock.lastCall?.[1] as { items: { style: object }[] };
    expect(input.items[0]?.style).not.toHaveProperty("dot");
    expect(UpdateItemsInput.safeParse(input).success).toBe(true);
  });
});
