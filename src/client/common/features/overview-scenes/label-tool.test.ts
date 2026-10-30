// FR-OVW-25, -26; OVW §11: click, type, Enter, and what a click, Esc or a dropped connection does.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  LABEL_STYLE_DEFAULT,
  LABEL_TEXT_MAX,
  OVW_INTENTS,
  PlaceLabelInput,
  UpdateItemsInput,
} from "@shared/overview-scenes/schemas";
import { IntentRejected } from "@ui/sync/connection";
import { toast } from "sonner";
import type { OverviewItemView } from "./item-layout";
import { ITEM_KIND_DEFS } from "./items/kinds";
import {
  cleanLabelText,
  openLabelEdit,
  setLabelFieldText,
  submitLabelField,
  labelPointer as tool,
  useLabelField,
} from "./label-tool";
import { initialEditor, publishItems, useOverviewEditor } from "./overview-editor";
import type { OverviewPointer } from "./overview-tools";
import { selectPointer } from "./select-tool";

const pointer = (over: Partial<OverviewPointer> = {}): OverviewPointer => ({
  x: 120.456,
  y: -30.5,
  screen: { x: 50, y: 60 },
  button: 0,
  ctrl: false,
  shift: false,
  alt: false,
  clicks: 1,
  client: "dm",
  overviewId: "o",
  item: null,
  live: true,
  signalsLive: true,
  scale: 1,
  intent: () => Promise.resolve(),
  signal: () => {},
  markPing: () => {},
  holdPan: () => {},
  ...over,
});

const label: OverviewItemView = {
  id: "l1",
  campaignId: "c",
  overviewId: "o",
  seq: 1,
  z: 0,
  kind: "label",
  x: 10,
  y: 20,
  w: null,
  h: null,
  hidden: false,
  assetId: null,
  text: "Thundertree",
  style: LABEL_STYLE_DEFAULT,
  characterId: null,
  ownerPlayerId: null,
  shape: null,
  locked: false,
};

const opts = { live: true, style: LABEL_STYLE_DEFAULT, hidden: false };
const click = (over: Partial<OverviewPointer> = {}) => {
  tool.down?.(pointer(over));
  tool.up?.(pointer(over));
};
const field = () => useLabelField.getState().field;

beforeEach(() => {
  useLabelField.setState({ field: null });
  useOverviewEditor.setState(initialEditor);
});

describe("FR-OVW-25 the Label tool", () => {
  test("FR-OVW-25 label in one go: click, type, Enter sends one place; the tool is ready again", async () => {
    click();
    expect(field()).toMatchObject({ overviewId: "o", itemId: null, x: 120.46, y: -30.5, text: "" });
    setLabelFieldText("  Thundertree ");
    const send = mock(() => Promise.resolve({ itemId: "new" }));
    await submitLabelField(send, opts);
    expect(send).toHaveBeenCalledTimes(1);
    const [name, input] = send.mock.lastCall as unknown as [string, unknown];
    expect(name).toBe(OVW_INTENTS.placeLabel);
    expect(input).toEqual({
      overviewId: "o",
      x: 120.46,
      y: -30.5,
      text: "Thundertree",
      style: LABEL_STYLE_DEFAULT,
    });
    expect(PlaceLabelInput.safeParse(input).success).toBe(true);
    expect(field()).toBeNull();
    click();
    expect(field()?.text).toBe("");
  });

  test("FR-OVW-20 FR-OVW-25 Add hidden places it hidden", async () => {
    click();
    setLabelFieldText("Secret");
    const send = mock((_: string, _i: unknown) => Promise.resolve({ itemId: "new" }));
    await submitLabelField(send, { ...opts, hidden: true });
    expect(send.mock.lastCall?.[1]).toMatchObject({ hidden: true });
  });

  test("FR-OVW-25 Esc cancels and stops there; with no field it goes on", () => {
    click();
    expect(tool.cancel?.("escape")).toBe(true);
    expect(field()).toBeNull();
    expect(tool.cancel?.("escape")).toBe(false);
  });

  test("FR-OVW-25 a drag pans: no field. A press alone isn't a click", () => {
    tool.down?.(pointer());
    tool.up?.(pointer({ screen: { x: 80, y: 60 } }));
    expect(field()).toBeNull();
    tool.up?.(pointer());
    expect(field()).toBeNull();
  });

  test("FR-OVW-25 a click over an item places on it: a map is an item too", () => {
    click({ item: label });
    expect(field()?.itemId).toBeNull();
  });

  test("FR-OVW-25 a click with the field open moves it, text and all", () => {
    click();
    setLabelFieldText("Conyberry");
    click({ x: 5, y: 6 });
    expect(field()).toMatchObject({ x: 5, y: 6, text: "Conyberry" });
  });

  test("FR-OVW-15 a click past the bounds lands on them", () => {
    click({ x: 20000, y: -20000 });
    expect(field()).toMatchObject({ x: 16384, y: -16384 });
  });

  test("FR-OVW-25 a tool switch drops the field", () => {
    click();
    expect(tool.cancel?.("tool")).toBe(false);
    expect(field()).toBeNull();
  });

  test("OVW §11 not live: no new field; an open one keeps its text, Enter is off until live", async () => {
    click({ live: false });
    expect(field()).toBeNull();
    click();
    setLabelFieldText("Conyberry");
    expect(tool.cancel?.("live")).toBe(false);
    expect(field()?.text).toBe("Conyberry");
    const send = mock(() => Promise.resolve({ itemId: "new" }));
    await submitLabelField(send, { ...opts, live: false });
    expect(send).not.toHaveBeenCalled();
    expect(field()?.text).toBe("Conyberry");
    await submitLabelField(send, opts);
    expect(send).toHaveBeenCalledTimes(1);
    expect(field()).toBeNull();
  });

  test("FR-OVW-25 a reject keeps the text and toasts; Enter twice sends once", async () => {
    const realError = toast.error;
    const toasted = mock((_: string) => "");
    toast.error = toasted as unknown as typeof toast.error;
    try {
      click();
      setLabelFieldText("Conyberry");
      let reject: (e: unknown) => void = () => {};
      const send = mock(() => new Promise((_, r) => (reject = r)));
      const sent = submitLabelField(send, opts);
      expect(field()?.sending).toBe(true);
      setLabelFieldText("changed");
      expect(field()?.text).toBe("Conyberry");
      await submitLabelField(send, opts);
      expect(send).toHaveBeenCalledTimes(1);
      reject(new IntentRejected("conflict", "Too many items"));
      await sent;
      expect(field()).toMatchObject({ text: "Conyberry", sending: false });
      expect(toasted).toHaveBeenCalledTimes(1);
    } finally {
      toast.error = realError;
    }
  });
});

describe("FR-OVW-26 text", () => {
  test("FR-OVW-26 clean, one line, 1–80: as the server takes it", () => {
    expect(cleanLabelText("  Thundertree ")).toBe("Thundertree");
    expect(cleanLabelText("   ")).toBeNull();
    expect(cleanLabelText("")).toBeNull();
    expect(cleanLabelText("two\nlines")).toBeNull();
    expect(cleanLabelText("a".repeat(LABEL_TEXT_MAX))).toHaveLength(LABEL_TEXT_MAX);
    expect(cleanLabelText("a".repeat(LABEL_TEXT_MAX + 1))).toBeNull();
    expect(cleanLabelText("🏰".repeat(LABEL_TEXT_MAX))).not.toBeNull();
  });

  test("FR-OVW-26 Enter with no text, or too much, sends nothing and keeps the field", async () => {
    click();
    const send = mock(() => Promise.resolve());
    await submitLabelField(send, opts);
    setLabelFieldText("a".repeat(LABEL_TEXT_MAX + 1));
    await submitLabelField(send, opts);
    expect(send).not.toHaveBeenCalled();
    expect(field()).not.toBeNull();
  });

  test("FR-OVW-26 Edit text: the menu entry opens the field; only a change is sent", async () => {
    const entry = ITEM_KIND_DEFS.label.menu.find((m) => m.id === "edit-text");
    const none = mock(() => Promise.resolve());
    entry?.run(label, none);
    expect(field()).toMatchObject({ itemId: "l1", text: "Thundertree", x: 10, y: 20 });
    const send = mock((_: string, _i: unknown) => Promise.resolve());
    await submitLabelField(send, opts);
    expect(send).not.toHaveBeenCalled();
    expect(field()).toBeNull();

    openLabelEdit(label);
    setLabelFieldText("Thundertree Ruins");
    await submitLabelField(send, opts);
    const [name, input] = send.mock.lastCall as [string, unknown];
    expect(name).toBe(OVW_INTENTS.updateItems);
    expect(input).toEqual({
      overviewId: "o",
      items: [{ itemId: "l1", text: "Thundertree Ruins" }],
    });
    expect(UpdateItemsInput.safeParse(input).success).toBe(true);
    expect(field()).toBeNull();
  });

  test("FR-OVW-26 a double-click opens it, on a locked label too; not while not live (FR-OVW-47)", () => {
    publishItems("o", [label]);
    selectPointer.down?.(pointer({ item: label, clicks: 2, live: false }));
    expect(field()).toBeNull();
    selectPointer.up?.(pointer({ item: label, live: false }));
    selectPointer.down?.(pointer({ item: { ...label, locked: true }, clicks: 2 }));
    expect(field()?.itemId).toBe("l1");
    expect(useOverviewEditor.getState().gesture).toBeNull();
  });
});
