// FR-OVW-37: the preview frames' rate and ending, and what a receiver does with them.
import { beforeEach, describe, expect, test } from "bun:test";
import { ItemDragData } from "@shared/overview-scenes/schemas";
import { clearPreviews, type DragTimers, prunePreviews } from "../scenes-map/drag-preview";
import { ItemDragSender, itemIdsOf, itemPreviews, receiveItemDrag } from "./overview-drag";

/** Fake clock: `advance` fires due timers in time order. */
function fakeTimers() {
  let t = 0;
  let nextId = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: DragTimers = {
    now: () => t,
    setTimeout(fn, ms) {
      const id = nextId++;
      due.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout(h) {
      due.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      due.delete(next[0]);
      t = next[1].at;
      next[1].fn();
    }
    t = end;
  };
  return { timers, advance };
}

const at = (x: number, y = 0) => [
  { itemId: "a", x, y },
  { itemId: "b", x: x + 100, y },
];

function sender() {
  const clock = fakeTimers();
  const sent: ItemDragData[] = [];
  const s = new ItemDragSender("o", (d) => sent.push(d), clock.timers);
  return { s, sent, ...clock };
}

describe("FR-OVW-37 sender", () => {
  test("FR-OVW-37 at most one frame per 50 ms, the newest position, only when it moved", () => {
    const { s, sent, advance } = sender();
    s.move(at(1));
    expect(sent.length).toBe(1);
    s.move(at(2));
    s.move(at(3));
    expect(sent.length).toBe(1);
    advance(50);
    expect(sent.length).toBe(2);
    expect(sent[1]).toEqual({ overviewId: "o", moves: at(3) });
    // The same place again: nothing.
    s.move(at(3));
    advance(50);
    expect(sent.length).toBe(2);
    // Every frame passes the signal's schema.
    for (const f of sent) expect(ItemDragData.safeParse(f).success).toBe(true);
  });

  test("FR-OVW-37 at rest it repeats every 1 s, so receivers' 3 s timeout never fires", () => {
    const { s, sent, advance } = sender();
    s.move(at(1));
    advance(1000);
    expect(sent.length).toBe(2);
    advance(1000);
    expect(sent.length).toBe(3);
    expect(sent[2]).toEqual(sent[0] as ItemDragData);
  });

  test("FR-OVW-37 finish sends `end` once, with the last frame's items, and stops the timers", () => {
    const { s, sent, advance } = sender();
    s.move(at(1));
    s.move(at(2));
    s.finish();
    s.finish();
    expect(sent.at(-1)).toEqual({ overviewId: "o", itemIds: ["a", "b"], end: true });
    expect(sent.length).toBe(2);
    advance(5000);
    s.move(at(9));
    expect(sent.length).toBe(2);
    expect(ItemDragData.safeParse(sent.at(-1)).success).toBe(true);
  });

  test("FR-OVW-37 nothing previewed: no `end`", () => {
    const { s, sent } = sender();
    s.finish();
    expect(sent).toEqual([]);
  });
});

describe("FR-OVW-37 receiver", () => {
  const view = (over: object = {}) => ({
    overviewId: "o",
    holds: (id: string) => id !== "secret",
    dragging: [] as string[],
    ...over,
  });
  const previews = () => itemPreviews.getState().previews;
  const frame = (...ids: string[]): ItemDragData => ({
    overviewId: "o",
    moves: ids.map((itemId) => ({ itemId, x: 5, y: 6 })),
  });

  beforeEach(() => clearPreviews(itemPreviews));

  test("FR-OVW-37 only for this overview and items it holds; not what it's dragging itself", () => {
    receiveItemDrag({ ...frame("a"), overviewId: "other" }, view(), 0);
    expect(previews()).toEqual({});
    receiveItemDrag(frame("a", "secret", "mine"), view({ dragging: ["mine"] }), 10);
    expect(previews()).toEqual({ a: { x: 5, y: 6, at: 10 } });
  });

  test("FR-OVW-37 a preview ends on `end`, on the item's change and after 3 s of silence", () => {
    receiveItemDrag(frame("a", "b", "c"), view(), 0);
    receiveItemDrag({ overviewId: "o", itemIds: ["a"], end: true }, view(), 1);
    expect(Object.keys(previews()).sort()).toEqual(["b", "c"]);

    const changed = itemIdsOf([
      { type: "overview-item", id: "b" },
      { type: "token", id: "c" },
    ]);
    expect(changed).toEqual(["b"]);
    clearPreviews(itemPreviews, changed);
    expect(Object.keys(previews())).toEqual(["c"]);

    // A dropped sender sends no `end`.
    prunePreviews(itemPreviews, 2999);
    expect(Object.keys(previews())).toEqual(["c"]);
    prunePreviews(itemPreviews, 3000);
    expect(previews()).toEqual({});
  });
});
