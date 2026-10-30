// FR-OVW-31, -32, -34: what the miniature tools send and what comes after; the kind's menu.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { OVW_INTENTS } from "@shared/overview-scenes/schemas";
import { toast } from "sonner";
import { resizeKeepingShape, sideBox } from "./item-edit";
import type { OverviewItemView } from "./item-layout";
import type { ItemMenuAction, ItemSend } from "./items/item-kind";
import { ITEM_KIND_DEFS } from "./items/kinds";
import {
  addPartyHere,
  EVERYONE_HERE,
  miniatureSizeAt,
  placeMiniatureFrom,
  viewCentre,
} from "./miniature-actions";
import { SELECT_TOOL_ID, useOverviewTool } from "./overview-canvas-context";
import { initialEditor, useOverviewEditor } from "./overview-editor";

const view = { x: -100, y: -200, scale: 0.5, w: 1000, h: 800 };

const sender = (result: unknown) => {
  const send = mock((_name: string, _input: unknown) => Promise.resolve(result));
  return send as typeof send & ItemSend;
};
const sentInput = (send: { mock: { calls: unknown[][] } }) => send.mock.calls[0]?.[1];

const mini = (over: Partial<OverviewItemView> = {}): OverviewItemView => ({
  id: "m",
  campaignId: "c",
  overviewId: "o",
  seq: 1,
  z: 0,
  kind: "miniature",
  x: 10,
  y: 20,
  w: 64,
  h: 64,
  hidden: false,
  assetId: "a",
  text: "Ship",
  style: null,
  characterId: null,
  ownerPlayerId: null,
  shape: "round",
  locked: false,
  ...over,
});

beforeEach(() => {
  useOverviewEditor.setState({ ...initialEditor, overviewId: "o", view }, true);
  useOverviewTool.setState({ tool: "add-party" });
});

describe("FR-OVW-34 size from zoom", () => {
  test("FR-OVW-34 starts at 64 px on the placer's screen, inside 8–4096", () => {
    expect(miniatureSizeAt(1)).toBe(64);
    expect(miniatureSizeAt(0.5)).toBe(128);
    expect(miniatureSizeAt(4)).toBe(16);
    expect(miniatureSizeAt(0.3)).toBe(213.33);
    expect(miniatureSizeAt(0.001)).toBe(4096);
    expect(miniatureSizeAt(100)).toBe(8);
  });

  test("FR-OVW-34 the handles keep it square, 8–4096", () => {
    const from = sideBox(mini({ w: 100, h: 100, x: 0, y: 0 }));
    const bounds = ITEM_KIND_DEFS.miniature.resize as { min: number; max: number };
    const grown = resizeKeepingShape(from, "se", { x: 300, y: 150 }, bounds);
    expect(grown).toEqual({ x: 0, y: 0, w: 300, h: 300 });
    const big = resizeKeepingShape(from, "se", { x: 9000, y: 9000 }, bounds);
    expect([big.w, big.h]).toEqual([4096, 4096]);
    const small = resizeKeepingShape(from, "nw", { x: 500, y: 500 }, bounds);
    expect([small.w, small.h]).toEqual([8, 8]);
  });

  test("the view's centre, in units", () => {
    expect(viewCentre(view)).toEqual({ x: 1200, y: 1200 });
  });
});

describe("FR-OVW-31 Add party", () => {
  test("FR-OVW-31 sends the view's centre and the size; the party lands selected, back on Select", async () => {
    const send = sender({ itemIds: ["a", "b"] });
    await addPartyHere(send, "o", false);
    expect(send.mock.calls[0]?.[0]).toBe(OVW_INTENTS.addParty);
    expect(sentInput(send)).toEqual({ overviewId: "o", x: 1200, y: 1200, size: 128 });
    expect(useOverviewEditor.getState().selection.tokenIds).toEqual(["a", "b"]);
    expect(useOverviewTool.getState().tool).toBe(SELECT_TOOL_ID);
  });

  test("FR-OVW-31 none missing: the toast; the tool and the selection stay", async () => {
    const shown = mock((_: string) => "");
    const real = toast.info;
    toast.info = shown as unknown as typeof toast.info;
    try {
      await addPartyHere(sender({ itemIds: [] }), "o", false);
    } finally {
      toast.info = real;
    }
    expect(shown).toHaveBeenCalledWith(EVERYONE_HERE);
    expect(useOverviewEditor.getState().selection.tokenIds).toEqual([]);
    expect(useOverviewTool.getState().tool).toBe("add-party");
  });

  test("FR-OVW-20 Add hidden goes along", async () => {
    const send = sender({ itemIds: ["a"] });
    await addPartyHere(send, "o", true);
    expect(sentInput(send)).toMatchObject({ hidden: true });
  });

  test("a rejection reaches the caller, nothing changes", async () => {
    const send = mock(() => Promise.reject(new Error("no")));
    await expect(addPartyHere(send, "o", false)).rejects.toThrow("no");
    expect(useOverviewTool.getState().tool).toBe("add-party");
  });
});

describe("FR-OVW-32 Add miniature", () => {
  test("FR-OVW-32 the picture, the name and the owner, centred; lands selected", async () => {
    useOverviewTool.setState({ tool: "add-miniature" });
    const send = sender({ itemId: "m" });
    await placeMiniatureFrom(send, "o", "img", { text: "  Ship ", ownerPlayerId: "p1" }, true);
    expect(send.mock.calls[0]?.[0]).toBe(OVW_INTENTS.placeMiniature);
    expect(sentInput(send)).toEqual({
      overviewId: "o",
      assetId: "img",
      x: 1136,
      y: 1136,
      size: 128,
      text: "Ship",
      ownerPlayerId: "p1",
      hidden: true,
    });
    expect(useOverviewEditor.getState().selection.tokenIds).toEqual(["m"]);
    expect(useOverviewTool.getState().tool).toBe(SELECT_TOOL_ID);
  });

  test("FR-OVW-32 name and owner are optional", async () => {
    const send = sender({ itemId: "m" });
    await placeMiniatureFrom(send, "o", "img", { text: "  ", ownerPlayerId: null }, false);
    expect(sentInput(send)).toEqual({
      overviewId: "o",
      assetId: "img",
      x: 1136,
      y: 1136,
      size: 128,
    });
  });
});

describe("FR-OVW-33 the kind's menu", () => {
  const actions = ITEM_KIND_DEFS.miniature.menu.filter((e): e is ItemMenuAction => "run" in e);
  const entry = (id: string) => actions.find((e) => e.id === id) as ItemMenuAction;

  test("FR-OVW-33 Name, Image…, Shape, Owner, in that order; Name and Image… off when linked", () => {
    expect(ITEM_KIND_DEFS.miniature.menu.map((e) => e.id)).toEqual([
      "name",
      "image",
      "shape",
      "owner",
    ]);
    for (const id of ["name", "image"]) {
      expect(entry(id).disabled?.(mini())).toBe(false);
      expect(entry(id).disabled?.(mini({ characterId: "char" }))).toBe(true);
    }
    // A lock doesn't stop Image…: no size change, unlike an image's.
    expect(entry("image").disabled?.(mini({ locked: true }))).toBe(false);
  });

  test("FR-OVW-32 Name opens its dialog, Image… the picker", () => {
    const send = sender(null);
    entry("name").run(mini(), send);
    expect(useOverviewEditor.getState().naming).toBe("m");
    entry("image").run(mini(), send);
    expect(useOverviewEditor.getState().picking).toEqual({ kind: "image", itemId: "m" });
  });
});
