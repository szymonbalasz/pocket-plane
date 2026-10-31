// FR-OVW-49 arrow keys: on an overview they move what a drag would.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GROUP_ACTION_MAX, OVW_INTENTS, POSITION_MAX } from "@shared/overview-scenes/schemas";
import { IntentRejected } from "@ui/sync/connection";
import { toast } from "sonner";
import { ITEM_STEP_PX, keyItems, stepItems } from "./item-keys";
import type { OverviewItemView } from "./item-layout";
import { initialEditor, useOverviewEditor } from "./overview-editor";

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

const miniature = (id: string, over: Partial<OverviewItemView> = {}) =>
  item(id, { kind: "miniature", ownerPlayerId: "p1", ...over });

const select = (...ids: string[]) =>
  useOverviewEditor.setState({ selection: { sceneId: null, tokenIds: ids } });

const RIGHT = { dx: 1, dy: 0 } as const;

beforeEach(() => {
  useOverviewEditor.setState(initialEditor, true);
});

describe("FR-OVW-49 what the keys move", () => {
  test("the DM: every selected unlocked item, of any kind; nothing selected, nothing", () => {
    const map = item("map", { locked: true });
    const label = item("label", { kind: "label" });
    const mira = miniature("mira");
    const all = [map, label, mira, item("other")];
    expect(keyItems(all, "dm", null)).toEqual([]);
    select("map", "label", "mira");
    expect(keyItems(all, "dm", null)).toEqual([label, mira]);
  });

  test("a player: only their own, shown; the one last pressed first, else their character", () => {
    const pet = miniature("pet");
    const mira = miniature("mira", { characterId: "c1" });
    const thorn = miniature("thorn", { ownerPlayerId: "p2", characterId: "c2" });
    const hidden = miniature("ghost", { hidden: true, characterId: "c3" });
    const all = [thorn, hidden, pet, mira];
    expect(keyItems(all, "player", "p1")).toEqual([mira]);
    useOverviewEditor.setState({ keyItem: "pet" });
    expect(keyItems(all, "player", "p1")).toEqual([pet]);
    expect(keyItems(all, "player", "p9")).toEqual([]);
    // A selection means nothing on a player's client.
    select("thorn");
    expect(keyItems(all, "player", "p1")).toEqual([pet]);
  });
});

describe("FR-OVW-49 a step", () => {
  const sender = () => mock((_name: string, _body: unknown) => Promise.resolve({} as unknown));

  test("one intent; the same distance on screen at any zoom, the group together", () => {
    const send = sender();
    const a = item("a");
    const b = item("b", { x: 400, y: 10 });
    const done = stepItems(send, "o", [a, b], RIGHT, 2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual([
      OVW_INTENTS.moveItems,
      {
        overviewId: "o",
        moves: [
          { itemId: "a", x: 100 + ITEM_STEP_PX / 2, y: 100 },
          { itemId: "b", x: 400 + ITEM_STEP_PX / 2, y: 10 },
        ],
      },
    ]);
    expect(done?.by).toBe(ITEM_STEP_PX / 2);
  });

  test("the position bound stops it, the group keeping its shape; nothing to send at the bound", () => {
    const send = sender();
    const near = item("near", { x: POSITION_MAX - 10 });
    const other = item("other", { x: 0 });
    stepItems(send, "o", [near, other], RIGHT, 1);
    expect(send.mock.calls[0]?.[1]).toEqual({
      overviewId: "o",
      moves: [
        { itemId: "near", x: POSITION_MAX, y: 100 },
        { itemId: "other", x: 10, y: 100 },
      ],
    });
    send.mockClear();
    expect(stepItems(send, "o", [item("at", { x: POSITION_MAX })], RIGHT, 1)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  test("no targets: nothing", () => {
    const send = sender();
    expect(stepItems(send, "o", [], RIGHT, 1)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  test("past the group cap: one toast, unsent, and the run ends", async () => {
    const send = sender();
    const error = mock(() => "");
    const original = toast.error;
    toast.error = error as typeof toast.error;
    const many = Array.from({ length: GROUP_ACTION_MAX + 1 }, (_, i) => item(`i${i}`));
    const done = stepItems(send, "o", many, RIGHT, 1);
    expect(send).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    await expect(done?.sent).rejects.toThrow();
    toast.error = original;
  });

  test("a refusal toasts and rejects, so a held key stops", async () => {
    const error = mock(() => "");
    const original = toast.error;
    toast.error = error as typeof toast.error;
    const refused = new IntentRejected("conflict", "Locked");
    const send = mock((_name: string, _body: unknown) => Promise.reject(refused));
    const done = stepItems(send, "o", [item("a")], RIGHT, 1);
    await expect(done?.sent).rejects.toBe(refused);
    expect(error).toHaveBeenCalledTimes(1);
    toast.error = original;
  });
});
