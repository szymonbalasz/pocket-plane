// FR-OVW-16, -18, -47: the Select tool's pointer rules, generic over kind.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { IntentRejected } from "@ui/sync/connection";
import { toast } from "sonner";
import type { OverviewItemView } from "./item-layout";
import { initialEditor, previewOf, publishItems, useOverviewEditor } from "./overview-editor";
import type { OverviewPointer } from "./overview-tools";
import { selectPointer as tool } from "./select-tool";

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

const pointer = (over: Partial<OverviewPointer> = {}): OverviewPointer => ({
  x: 0,
  y: 0,
  screen: { x: 0, y: 0 },
  button: 0,
  ctrl: false,
  shift: false,
  alt: false,
  clicks: 1,
  client: "dm",
  overviewId: "o",
  myPlayerId: null,
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

/** A pointer at (x, y) units, with the screen at the same place. */
const at = (x: number, y: number, over: Partial<OverviewPointer> = {}) =>
  pointer({ x, y, screen: { x, y }, ...over });

const selection = () => useOverviewEditor.getState().selection.tokenIds;
const gesture = () => useOverviewEditor.getState().gesture;
const flush = () => new Promise((r) => setTimeout(r, 0));
const select = (...ids: string[]) =>
  useOverviewEditor.setState({ selection: { sceneId: null, tokenIds: ids } });

const a = item("a");
const b = item("b", { x: 400 });
const locked = item("map", { x: 0, y: 0, w: 1000, h: 1000, locked: true });

beforeEach(() => {
  useOverviewEditor.setState(initialEditor, true);
  publishItems("o", [locked, a, b]);
});

describe("FR-OVW-16 select", () => {
  test("FR-OVW-16 click selects, Ctrl- or Shift-click toggles, an empty click clears", () => {
    const click = (p: OverviewPointer) => {
      tool.down?.(p);
      tool.up?.(p);
    };
    click(at(120, 120, { item: a }));
    expect(selection()).toEqual(["a"]);
    click(at(420, 120, { item: b, ctrl: true }));
    expect(selection()).toEqual(["a", "b"]);
    click(at(420, 120, { item: b, shift: true }));
    expect(selection()).toEqual(["a"]);
    click(at(5000, 5000));
    expect(selection()).toEqual([]);
  });

  test("FR-OVW-16 locked pans: a left-drag on a locked item pans, nothing moves", () => {
    const holdPan = mock(() => {});
    const intent = mock(() => Promise.resolve());
    tool.down?.(at(500, 500, { item: locked, holdPan }));
    expect(holdPan).not.toHaveBeenCalled();
    tool.move?.(at(600, 600, { item: locked }));
    tool.up?.(at(600, 600, { item: locked, intent }));
    expect(intent).not.toHaveBeenCalled();
    expect(gesture()).toBeNull();
    // A pan is no click: it changes no selection.
    expect(selection()).toEqual([]);
  });

  test("FR-OVW-16 locked pans: a click still selects it, its menu still opens", () => {
    tool.down?.(at(500, 500, { item: locked }));
    tool.up?.(at(501, 500, { item: locked }));
    expect(selection()).toEqual(["map"]);
    const open = tool.menu?.(at(500, 500, { item: locked }));
    expect(typeof open).toBe("function");
    (open as () => void)();
    expect(useOverviewEditor.getState().menu?.itemId).toBe("map");
  });

  test("FR-OVW-16 a Ctrl-drag on a locked map is a box, and takes no locked item", () => {
    const holdPan = mock(() => {});
    tool.down?.(at(50, 50, { item: locked, ctrl: true, holdPan }));
    expect(holdPan).toHaveBeenCalled();
    tool.move?.(at(600, 300, { ctrl: true }));
    expect(gesture()).toMatchObject({ kind: "box", at: { x: 600, y: 300 } });
    tool.up?.(at(600, 300, { ctrl: true }));
    expect(selection()).toEqual(["a", "b"]);
  });

  test("FR-OVW-16 a player's press only pans: no selection, no gesture, no menu", () => {
    const holdPan = mock(() => {});
    const player = { client: "player" as const, holdPan };
    tool.down?.(at(120, 120, { item: a, ...player }));
    tool.up?.(at(120, 120, { item: a, ...player }));
    expect(holdPan).not.toHaveBeenCalled();
    expect(selection()).toEqual([]);
    expect(gesture()).toBeNull();
    expect(tool.menu?.(at(120, 120, { item: a, ...player }))).toBe(false);
  });

  test("FR-OVW-16 Esc drops a box and stops there; with no gesture it isn't taken", () => {
    tool.down?.(at(50, 50, { ctrl: true }));
    expect(tool.cancel?.("escape")).toBe(true);
    expect(gesture()).toBeNull();
    expect(tool.cancel?.("escape")).toBe(false);
  });
});

describe("FR-OVW-18 group move", () => {
  test("FR-OVW-18 group move: every selected unlocked item, one intent on drop", () => {
    select("a", "b", "map");
    const intent = mock((_n: string, _i: unknown) => Promise.resolve());
    tool.down?.(at(120, 120, { item: a }));
    tool.move?.(at(130, 140));
    tool.move?.(at(170, 180));
    expect(intent).not.toHaveBeenCalled();
    tool.up?.(at(170, 180, { intent }));
    expect(intent).toHaveBeenCalledTimes(1);
    expect(intent.mock.lastCall?.[0]).toBe("ovw.moveItems");
    expect(intent.mock.lastCall?.[1]).toEqual({
      overviewId: "o",
      moves: [
        { itemId: "a", x: 150, y: 160 },
        { itemId: "b", x: 450, y: 160 },
      ],
    });
    expect(selection()).toEqual(["a", "b", "map"]);
  });

  test("FR-OVW-18 a press on an item outside the selection moves it alone", () => {
    select("a");
    const intent = mock((_n: string, _i: unknown) => Promise.resolve());
    tool.down?.(at(420, 120, { item: b }));
    tool.move?.(at(450, 120));
    tool.up?.(at(450, 120, { intent }));
    expect(selection()).toEqual(["b"]);
    expect(intent.mock.lastCall?.[1]).toMatchObject({ moves: [{ itemId: "b" }] });
  });

  test("FR-OVW-18 a click on a selected item in a group narrows to it, unsent", () => {
    select("a", "b");
    const intent = mock(() => Promise.resolve());
    tool.down?.(at(120, 120, { item: a }));
    tool.up?.(at(121, 120, { intent }));
    expect(intent).not.toHaveBeenCalled();
    expect(selection()).toEqual(["a"]);
  });

  test("FR-OVW-18 no optimistic state: the drop shows until the ack, the record stays", async () => {
    select("a");
    let ack = () => {};
    const intent = () =>
      new Promise<void>((r) => {
        ack = r;
      });
    tool.down?.(at(120, 120, { item: a }));
    tool.move?.(at(170, 170));
    tool.up?.(at(170, 170, { intent }));
    const g = gesture();
    if (g?.kind !== "move") throw new Error("no gesture");
    expect(g.sending).toBe(true);
    expect(previewOf(g, a)).toEqual({ x: 150, y: 150 });
    expect(useOverviewEditor.getState().items.find((i) => i.id === "a")?.x).toBe(100);
    ack();
    await flush();
    expect(gesture()).toBeNull();
  });

  test("FR-OVW-18 a reject snaps back and toasts", async () => {
    select("a");
    const seen = mock((_: string) => "");
    const real = toast.error;
    toast.error = seen as unknown as typeof toast.error;
    const intent = () => Promise.reject(new IntentRejected("conflict", "Item is locked"));
    tool.down?.(at(120, 120, { item: a }));
    tool.move?.(at(170, 170));
    tool.up?.(at(170, 170, { intent }));
    await flush();
    toast.error = real;
    expect(gesture()).toBeNull();
    expect(seen).toHaveBeenCalledWith("Item is locked");
  });

  test("FR-OVW-47 not live: selection works, a drag isn't started, the drop isn't sent", () => {
    const intent = mock(() => Promise.resolve());
    tool.down?.(at(120, 120, { item: a, live: false }));
    expect(gesture()?.kind).toBe("press");
    tool.up?.(at(120, 120, { item: a, live: false, intent }));
    expect(selection()).toEqual(["a"]);
    // A connection lost mid-drag: dropped, unsent.
    tool.down?.(at(120, 120, { item: a }));
    tool.move?.(at(170, 170));
    tool.cancel?.("live");
    expect(gesture()).toBeNull();
    tool.up?.(at(170, 170, { intent }));
    expect(intent).not.toHaveBeenCalled();
  });

  test("FR-OVW-16 Esc drops a move before it's sent", () => {
    select("a");
    tool.down?.(at(120, 120, { item: a }));
    tool.move?.(at(170, 170));
    expect(tool.cancel?.("escape")).toBe(true);
    expect(gesture()).toBeNull();
  });

  test("§9 more than 50 selected: refused on the drop, not sent", () => {
    const many = Array.from({ length: 51 }, (_, i) => item(`m${i}`));
    publishItems("o", many);
    select(...many.map((m) => m.id));
    const intent = mock(() => Promise.resolve());
    tool.down?.(at(120, 120, { item: many[0] as OverviewItemView }));
    tool.move?.(at(170, 170));
    tool.up?.(at(170, 170, { intent }));
    expect(intent).not.toHaveBeenCalled();
    expect(gesture()).toBeNull();
  });
});

describe("FR-OVW-23 handles", () => {
  test("FR-OVW-23 keeps its shape: a corner of the one selected item resizes it, one intent", () => {
    select("a");
    const holdPan = mock(() => {});
    const intent = mock((_n: string, _i: unknown) => Promise.resolve());
    tool.down?.(at(200, 150, { item: a, holdPan }));
    expect(holdPan).toHaveBeenCalled();
    expect(gesture()).toMatchObject({ kind: "resize", handle: "se" });
    tool.move?.(at(300, 200));
    tool.up?.(at(300, 200, { intent }));
    expect(intent.mock.lastCall?.[0]).toBe("ovw.updateItems");
    expect(intent.mock.lastCall?.[1]).toEqual({
      overviewId: "o",
      items: [{ itemId: "a", x: 100, y: 100, w: 200, h: 100 }],
    });
  });

  test("FR-OVW-23 no handles on a group, a locked item or a label", () => {
    select("a", "b");
    tool.down?.(at(200, 150, { item: a }));
    expect(gesture()?.kind).toBe("move");
    tool.cancel?.("escape");
    const lockedA = item("a", { locked: true });
    publishItems("o", [lockedA, b]);
    select("a");
    tool.down?.(at(200, 150, { item: lockedA }));
    expect(gesture()?.kind).toBe("press");
    tool.cancel?.("escape");
    const label = item("a", { kind: "label", w: null, h: null });
    publishItems("o", [label, b]);
    tool.down?.(at(100, 100, { item: label }));
    expect(gesture()?.kind).toBe("move");
  });

  test("FR-OVW-23 a hovered corner shows its resize cursor", () => {
    select("a");
    tool.move?.(at(200, 150));
    expect(useOverviewEditor.getState().cursor).toBe("nwse-resize");
    tool.move?.(at(200, 100));
    expect(useOverviewEditor.getState().cursor).toBe("nesw-resize");
    tool.move?.(at(150, 125));
    expect(useOverviewEditor.getState().cursor).toBeNull();
  });
});

describe("FR-OVW-35 a player's press", () => {
  const own = item("own", { kind: "miniature", ownerPlayerId: "p1", locked: undefined });
  const theirs = item("theirs", { kind: "miniature", ownerPlayerId: "p2", locked: undefined });
  const nobodys = item("nobody", { kind: "miniature", locked: undefined });
  const mine = (x: number, y: number, over: Partial<OverviewPointer> = {}) =>
    at(x, y, { client: "player", myPlayerId: "p1", ...over });

  beforeEach(() => {
    useOverviewEditor.setState(initialEditor, true);
    publishItems("o", [own, theirs, nobodys]);
  });

  test("FR-OVW-35 own miniature drags, one intent on drop, no selection or menu", async () => {
    const intent = mock((_: string, __: unknown) => Promise.resolve());
    const hold = mock(() => {});
    tool.down?.(mine(100, 100, { item: own, holdPan: hold }));
    expect(hold).toHaveBeenCalled();
    expect(selection()).toEqual([]);
    tool.move?.(mine(150, 130, { item: own }));
    const g = gesture();
    expect(previewOf(g?.kind === "move" ? g : null, own)).toEqual({ x: 150, y: 130 });
    tool.up?.(mine(150, 130, { item: own, intent }));
    expect(intent).toHaveBeenCalledWith("ovw.moveItems", {
      overviewId: "o",
      moves: [{ itemId: "own", x: 150, y: 130 }],
    });
    expect(selection()).toEqual([]);
    expect(tool.menu?.(mine(100, 100, { item: own }))).toBe(false);
    await flush();
    expect(gesture()).toBeNull();
  });

  test("FR-OVW-35 a click without a drag does nothing: no intent, no selection", () => {
    const intent = mock(() => Promise.resolve());
    tool.down?.(mine(100, 100, { item: own }));
    tool.up?.(mine(100, 100, { item: own, intent }));
    expect(intent).not.toHaveBeenCalled();
    expect(selection()).toEqual([]);
    expect(gesture()).toBeNull();
  });

  test("FR-OVW-35 anything else still pans: another's, nobody's, a label, empty canvas", () => {
    const label = item("l", { kind: "label", w: null, h: null, locked: undefined });
    for (const target of [theirs, nobodys, label, a, null]) {
      const hold = mock(() => {});
      tool.down?.(mine(100, 100, { item: target, holdPan: hold }));
      expect(hold).not.toHaveBeenCalled();
      expect(gesture()).toBeNull();
    }
  });

  test("FR-OVW-47 not live: a press pans; a drag cut short snaps back, unsent", () => {
    const intent = mock(() => Promise.resolve());
    tool.down?.(mine(100, 100, { item: own, live: false }));
    expect(gesture()).toBeNull();
    tool.down?.(mine(100, 100, { item: own }));
    tool.move?.(mine(150, 130, { item: own }));
    tool.cancel?.("live");
    expect(gesture()).toBeNull();
    tool.up?.(mine(150, 130, { intent, live: false }));
    expect(intent).not.toHaveBeenCalled();
  });

  test("FR-OVW-35 a refused drop snaps back and toasts", async () => {
    const shown = mock((_: string) => "");
    const real = toast.error;
    toast.error = shown as unknown as typeof toast.error;
    try {
      tool.down?.(mine(100, 100, { item: own }));
      tool.move?.(mine(150, 130, { item: own }));
      const intent = () => Promise.reject(new IntentRejected("not_found", "Item not found"));
      tool.up?.(mine(150, 130, { item: own, intent }));
      await flush();
      expect(gesture()).toBeNull();
      expect(shown).toHaveBeenCalled();
    } finally {
      toast.error = real;
    }
  });

  test("the grab cursor is over their own miniature only", () => {
    tool.move?.(mine(100, 100, { item: own }));
    expect(useOverviewEditor.getState().cursor).toBe("grab");
    tool.move?.(mine(100, 100, { item: theirs }));
    expect(useOverviewEditor.getState().cursor).toBeNull();
  });
});

describe("FR-OVW-37 preview frames", () => {
  const frames = () => {
    const sent: { name: string; data: Record<string, unknown> }[] = [];
    const signal = (name: string, data: unknown) =>
      sent.push({ name, data: data as Record<string, unknown> });
    return { sent, signal };
  };

  test("FR-OVW-37 a DM group drag: frames for every moved item; on drop the intent, then `end`", () => {
    const { sent, signal } = frames();
    const order: string[] = [];
    const intent = (name: string) => {
      order.push(name);
      return Promise.resolve();
    };
    select("a", "b");
    tool.down?.(at(150, 120, { item: a, signal }));
    tool.move?.(at(160, 130, { item: a, signal }));
    expect(sent[0]).toEqual({
      name: "ovw.drag",
      data: {
        overviewId: "o",
        moves: [
          { itemId: "a", x: 110, y: 110 },
          { itemId: "b", x: 410, y: 110 },
        ],
      },
    });
    tool.up?.(
      at(160, 130, {
        item: a,
        signal: (n, d) => signal(n, d),
        intent: intent as OverviewPointer["intent"],
      }),
    );
    expect(order).toEqual(["ovw.moveItems"]);
    expect(sent.at(-1)?.data).toEqual({ overviewId: "o", itemIds: ["a", "b"], end: true });
  });

  test("FR-OVW-37 a click sends no frame; Esc sends `end`, no intent", () => {
    const { sent, signal } = frames();
    tool.down?.(at(150, 120, { item: a, signal }));
    tool.up?.(at(150, 120, { item: a, signal }));
    expect(sent).toEqual([]);

    tool.down?.(at(150, 120, { item: a, signal }));
    tool.move?.(at(170, 140, { item: a, signal }));
    expect(tool.cancel?.("escape")).toBe(true);
    expect(sent.at(-1)?.data).toEqual({ overviewId: "o", itemIds: ["a"], end: true });
  });

  test("FR-OVW-37 a player's drag: one item in the frame", () => {
    const { sent, signal } = frames();
    const own = item("own", { kind: "miniature", ownerPlayerId: "p1" });
    publishItems("o", [own]);
    const p = (x: number, y: number) =>
      at(x, y, { client: "player", myPlayerId: "p1", item: own, signal });
    tool.down?.(p(100, 100));
    tool.move?.(p(130, 100));
    expect(sent[0]?.data).toEqual({
      overviewId: "o",
      moves: [{ itemId: "own", x: 130, y: 100 }],
    });
    tool.cancel?.("escape");
  });
});
