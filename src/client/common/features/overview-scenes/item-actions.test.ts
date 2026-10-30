// FR-OVW-19–22: what the menu, the keys and Add image send.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GROUP_ACTION_MAX } from "@shared/overview-scenes/schemas";
import { toast } from "sonner";
import { loadAddHidden, saveAddHidden } from "./add-hidden";
import {
  askDelete,
  confirmedDelete,
  duplicate,
  menuTargets,
  openItemMenu,
  placeImageFrom,
  setHidden,
  setLocked,
  stack,
  swapImage,
} from "./item-actions";
import { itemBands, type OverviewItemView } from "./item-layout";
import { ITEM_KIND_DEFS } from "./items/kinds";
import { itemKey, LOCKED_NOT_DELETED } from "./OverviewEditorHost";
import { SELECT_TOOL_ID, useOverviewTool } from "./overview-canvas-context";
import { initialEditor, publishItems, useOverviewEditor } from "./overview-editor";

const toasted = mock((_: string) => "");
const realError = toast.error;

const item = (id: string, over: Partial<OverviewItemView> = {}): OverviewItemView => ({
  id,
  campaignId: "c",
  overviewId: "o",
  seq: 1,
  z: 0,
  kind: "image",
  x: 100,
  y: 100,
  w: 100,
  h: 50,
  hidden: false,
  assetId: "a",
  text: null,
  style: null,
  characterId: null,
  ownerPlayerId: null,
  shape: null,
  locked: false,
  ...over,
});

const sender = (result?: unknown) => mock((_n: string, _i: unknown) => Promise.resolve(result));
const a = item("a");
const b = item("b", { hidden: true });
const map = item("map", { locked: true });
const select = (...ids: string[]) =>
  useOverviewEditor.setState({ selection: { sceneId: null, tokenIds: ids } });
const key = (k: string, over: Partial<KeyboardEvent> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, preventDefault: () => {}, ...over }) as KeyboardEvent;

beforeEach(() => {
  toasted.mockClear();
  toast.error = toasted as unknown as typeof toast.error;
  useOverviewEditor.setState(initialEditor, true);
  publishItems("o", [map, a, b]);
});
afterEach(() => {
  toast.error = realError;
  useOverviewTool.getState().setTool(SELECT_TOOL_ID);
});

describe("FR-OVW-19 stack", () => {
  test("FR-OVW-19 To front and To back send `stack` per item", async () => {
    const send = sender();
    await stack(send, [a, b], "front");
    expect(send).toHaveBeenCalledWith("ovw.updateItems", {
      overviewId: "o",
      items: [
        { itemId: "a", stack: "front" },
        { itemId: "b", stack: "front" },
      ],
    });
    await stack(send, [a], "back");
    expect(send.mock.lastCall?.[1]).toEqual({
      overviewId: "o",
      items: [{ itemId: "a", stack: "back" }],
    });
  });

  test("FR-OVW-19 bands draw images < labels < miniatures; a later map stays under the party", () => {
    const bands = itemBands([
      item("late-map", { z: 9, seq: 9 }),
      item("mini", { kind: "miniature", z: 0 }),
      item("label", { kind: "label", z: 0 }),
      item("early-map", { z: 0 }),
    ]);
    expect(bands.image.map((i) => i.id)).toEqual(["early-map", "late-map"]);
    expect(bands.label.map((i) => i.id)).toEqual(["label"]);
    expect(bands.miniature.map((i) => i.id)).toEqual(["mini"]);
  });
});

describe("FR-OVW-20 hide and reveal", () => {
  test("FR-OVW-20 hide sends only the items that change; nothing changes → nothing sent", async () => {
    const send = sender();
    await setHidden(send, [a, b], true);
    expect(send).toHaveBeenCalledWith("ovw.updateItems", {
      overviewId: "o",
      items: [{ itemId: "a", hidden: true }],
    });
    send.mockClear();
    await setHidden(send, [b], true);
    expect(send).not.toHaveBeenCalled();
  });

  test("FR-OVW-20 Add hidden is remembered per browser", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
    expect(loadAddHidden(storage)).toBe(false);
    saveAddHidden(true, storage);
    expect(loadAddHidden(storage)).toBe(true);
    saveAddHidden(false, storage);
    expect(loadAddHidden(storage)).toBe(false);
    // Blocked storage: off, and no throw.
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadAddHidden(blocked)).toBe(false);
    saveAddHidden(true, blocked);
    expect(loadAddHidden(null)).toBe(false);
  });

  test("FR-OVW-20 Add hidden places it hidden; off sends no flag", async () => {
    const send = sender({ itemId: "new" });
    const asset = { id: "img", displayWidth: 100, displayHeight: 100 };
    await placeImageFrom(send, "o", asset, true);
    expect(send.mock.lastCall?.[1]).toMatchObject({ hidden: true });
    await placeImageFrom(send, "o", asset, false);
    expect(send.mock.lastCall?.[1]).not.toHaveProperty("hidden");
  });
});

describe("FR-OVW-21 menu and keys", () => {
  test("FR-OVW-21 a menu acts on the selection if the item is in it, else on the item", () => {
    select("a", "b");
    expect(menuTargets(a).map((i) => i.id)).toEqual(["a", "b"]);
    expect(menuTargets(map).map((i) => i.id)).toEqual(["map"]);
    openItemMenu(map, { x: 1, y: 2 });
    expect(useOverviewEditor.getState().selection.tokenIds).toEqual(["map"]);
    expect(useOverviewEditor.getState().menu).toEqual({ itemId: "map", at: { x: 1, y: 2 } });
  });

  test("FR-OVW-21 Lock sends the flag; deleting one goes at once", async () => {
    const send = sender();
    await setLocked(send, [a, map], true);
    expect(send.mock.lastCall?.[1]).toEqual({
      overviewId: "o",
      items: [{ itemId: "a", locked: true }],
    });
    await askDelete(send, [a]);
    expect(send).toHaveBeenLastCalledWith("ovw.deleteItems", { overviewId: "o", itemIds: ["a"] });
    expect(useOverviewEditor.getState().confirmDelete).toBeNull();
  });

  test("FR-OVW-21 deleting more than one asks first; the confirm sends one intent", async () => {
    const send = sender();
    await askDelete(send, [a, b]);
    expect(send).not.toHaveBeenCalled();
    expect(useOverviewEditor.getState().confirmDelete).toEqual(["a", "b"]);
    await confirmedDelete(send);
    expect(send).toHaveBeenCalledWith("ovw.deleteItems", {
      overviewId: "o",
      itemIds: ["a", "b"],
    });
    expect(useOverviewEditor.getState().confirmDelete).toBeNull();
  });

  test("FR-OVW-21 Delete acts on the selection, not on locked items", () => {
    const send = sender();
    select("a", "map");
    itemKey(key("Delete"), send, true);
    expect(send).toHaveBeenCalledWith("ovw.deleteItems", { overviewId: "o", itemIds: ["a"] });
    send.mockClear();
    select("map");
    itemKey(key("Delete"), send, true);
    expect(send).not.toHaveBeenCalled();
    expect(toasted).toHaveBeenCalledWith(LOCKED_NOT_DELETED);
  });

  test("FR-OVW-21 Ctrl-D duplicates the selection and selects the copies", async () => {
    const send = sender({ itemIds: ["c1", "c2"] });
    select("a", "b");
    const preventDefault = mock(() => {});
    itemKey(key("d", { ctrlKey: true, preventDefault }), send, true);
    expect(preventDefault).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("ovw.duplicateItems", {
      overviewId: "o",
      itemIds: ["a", "b"],
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(useOverviewEditor.getState().selection.tokenIds).toEqual(["c1", "c2"]);
  });

  test("FR-OVW-21 Esc clears; FR-OVW-47 Delete and Ctrl-D are off while not live", () => {
    const send = sender();
    select("a");
    itemKey(key("Delete"), send, false);
    itemKey(key("d", { ctrlKey: true }), send, false);
    expect(send).not.toHaveBeenCalled();
    itemKey(key("Escape"), send, false);
    expect(useOverviewEditor.getState().selection.tokenIds).toEqual([]);
  });

  test("§9 a group action over 50 items isn't sent", async () => {
    const many = Array.from({ length: GROUP_ACTION_MAX + 1 }, (_, i) => item(`m${i}`));
    const send = sender({ itemIds: [] });
    await duplicate(send, many);
    await stack(send, many, "front");
    await askDelete(send, many);
    expect(send).not.toHaveBeenCalled();
    expect(useOverviewEditor.getState().confirmDelete).toBeNull();
    expect(toasted).toHaveBeenCalledTimes(3);
  });

  test("FR-OVW-21 each kind brings its own entries: only an image has Image…", () => {
    expect(ITEM_KIND_DEFS.image.menu.map((e) => e.id)).toContain("image");
    expect(ITEM_KIND_DEFS.label.resize).toBeNull();
    expect(ITEM_KIND_DEFS.miniature.resize).toEqual({ min: 8, max: 4096 });
  });

  test("FR-OVW-23 Image… is off on a locked image, and asks for the picker", () => {
    const entry = ITEM_KIND_DEFS.image.menu.find((e) => e.id === "image");
    expect(entry?.disabled?.(map)).toBe(true);
    expect(entry?.disabled?.(a)).toBe(false);
    entry?.run(a, sender());
    expect(useOverviewEditor.getState().picking).toEqual({ kind: "image", itemId: "a" });
  });
});

describe("FR-OVW-22 Add image", () => {
  const asset = { id: "img", displayWidth: 2000, displayHeight: 1000 };

  test("FR-OVW-22 on an empty overview: display size, fit on arrival, then Select with it selected", async () => {
    publishItems("empty", []);
    useOverviewTool.getState().setTool("add-image");
    const send = sender({ itemId: "new" });
    const sent = placeImageFrom(send, "empty", asset, false);
    expect(useOverviewEditor.getState().fitOnArrival).toBe("empty");
    expect(send).toHaveBeenCalledWith("ovw.placeImage", {
      overviewId: "empty",
      assetId: "img",
      x: 0,
      y: 0,
      w: 2000,
      h: 1000,
    });
    await sent;
    expect(useOverviewEditor.getState().selection.tokenIds).toEqual(["new"]);
    expect(useOverviewTool.getState().tool).toBe(SELECT_TOOL_ID);
  });

  test("FR-OVW-22 otherwise: the view's centre, no fit", async () => {
    useOverviewEditor.setState({ view: { x: 0, y: 0, scale: 1, w: 1000, h: 800 } });
    const send = sender({ itemId: "new" });
    await placeImageFrom(send, "o", asset, false);
    expect(send.mock.lastCall?.[1]).toMatchObject({ x: 250, y: 275, w: 500, h: 250 });
    expect(useOverviewEditor.getState().fitOnArrival).toBeNull();
  });

  test("FR-OVW-22 a reject drops the pending fit and stays on the tool", async () => {
    publishItems("empty", []);
    useOverviewTool.getState().setTool("add-image");
    const send = mock(() => Promise.reject(new Error("conflict")));
    await expect(placeImageFrom(send, "empty", asset, false)).rejects.toThrow("conflict");
    expect(useOverviewEditor.getState().fitOnArrival).toBeNull();
    expect(useOverviewTool.getState().tool).toBe("add-image");
  });

  test("FR-OVW-23 swapping the picture keeps the width, takes the new shape", async () => {
    const send = sender();
    await swapImage(send, item("a", { w: 300, h: 300 }), asset);
    expect(send).toHaveBeenCalledWith("ovw.updateItems", {
      overviewId: "o",
      items: [{ itemId: "a", assetId: "img", w: 300, h: 150 }],
    });
  });
});
