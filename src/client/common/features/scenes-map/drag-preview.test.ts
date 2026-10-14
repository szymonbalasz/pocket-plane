import { describe, expect, test } from "bun:test";
import type { DragData } from "@shared/scenes-map/schemas";
import {
  clearPreviews,
  createPreviewStore,
  type DragTimers,
  escapeTarget,
  type PreviewView,
  prunePreviews,
  receiveDrag,
  TokenDrag,
  tokenIdsOf,
} from "./drag-preview";

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
  return { timers, advance, pending: () => due.size };
}

function setup() {
  const clock = fakeTimers();
  const sent: (DragData | { intent: { col: number; row: number } })[] = [];
  const drag = new TokenDrag("s1", "goblin", { col: 2, row: 3 }, (d) => sent.push(d), clock.timers);
  const frames = () => sent.filter((d) => !("intent" in d)) as DragData[];
  const sendMove = (to: { col: number; row: number }) => sent.push({ intent: to });
  return { clock, sent, drag, frames, sendMove };
}

describe("FR-MAP-39 drag preview sender", () => {
  test("FR-MAP-39 throttle: ≤ 1 frame / 50 ms, latest position, none when still", () => {
    const { clock, drag, frames } = setup();
    drag.move(10, 10);
    expect(frames()).toEqual([{ sceneId: "s1", tokenId: "goblin", x: 10, y: 10 }]);
    for (let i = 1; i <= 9; i++) {
      clock.advance(5);
      drag.move(10 + i, 10);
    }
    expect(frames()).toHaveLength(1);
    clock.advance(5); // 50 ms after the first frame: the latest pending position goes
    expect(frames()).toHaveLength(2);
    expect(frames()[1]).toMatchObject({ x: 19, y: 10 });
    // Same position again: nothing sent.
    clock.advance(60);
    drag.move(19, 10);
    clock.advance(60);
    expect(frames()).toHaveLength(2);
    // 20 s of continuous movement at 200 Hz: ≤ 20 frames/s.
    for (let i = 0; i < 4000; i++) {
      clock.advance(5);
      drag.move(100 + i, 0);
    }
    expect(frames().length - 2).toBeLessThanOrEqual(20 * 20 + 1);
  });

  test("FR-MAP-39 at rest: the last position repeats every 1 s", () => {
    const { clock, drag, frames } = setup();
    drag.move(40, 50);
    clock.advance(999);
    expect(frames()).toHaveLength(1);
    clock.advance(1);
    expect(frames()).toHaveLength(2);
    clock.advance(2000);
    expect(frames()).toHaveLength(4);
    for (const f of frames()) expect(f).toEqual({ sceneId: "s1", tokenId: "goblin", x: 40, y: 50 });
    // Moving again restarts the 1 s repeat from that frame.
    drag.move(41, 50);
    clock.advance(500);
    expect(frames()).toHaveLength(5);
  });

  test("FR-MAP-39 drop: map.moveToken first, then `end`; timers stop", () => {
    const { clock, drag, sent, sendMove } = setup();
    drag.move(300, 200);
    const at = drag.finish({ col: 4, row: 3 }, true, sendMove);
    expect(at).toEqual({ col: 4, row: 3 });
    expect(sent.slice(1)).toEqual([
      { intent: { col: 4, row: 3 } },
      { sceneId: "s1", tokenId: "goblin", end: true },
    ]);
    clock.advance(5000);
    expect(sent).toHaveLength(3);
    expect(clock.pending()).toBe(0);
  });

  test("FR-MAP-15 Esc cancels drag: token back, no map.moveToken, `end` sent", () => {
    const { clock, drag, sent, sendMove } = setup();
    drag.move(300, 200);
    clock.advance(2000); // held mid-way: repeats
    drag.cancel();
    expect(drag.isCancelled).toBe(true);
    const at = drag.finish({ col: 6, row: 3 }, true, sendMove);
    expect(at).toEqual({ col: 2, row: 3 });
    expect(sent.some((d) => "intent" in d)).toBe(false);
    expect(sent.at(-1)).toEqual({ sceneId: "s1", tokenId: "goblin", end: true });
    clock.advance(5000);
    expect(clock.pending()).toBe(0);
  });

  test("FR-MAP-15 Esc goes to the drag first, then a box, else falls through (selection clear)", () => {
    expect(escapeTarget(true, false)).toBe("drag");
    expect(escapeTarget(true, true)).toBe("drag");
    expect(escapeTarget(false, true)).toBe("box");
    // No drag and no box: the DM's Esc-clears-selection handler gets it. With a drag, the
    // canvas consumes Esc, so the selection is kept.
    expect(escapeTarget(false, false)).toBeNull();
  });

  test("FR-MAP-39 not live: the drop snaps back, no intent; frames go to the (dropping) sender", () => {
    const sentLive: DragData[] = [];
    let live = true;
    const clock = fakeTimers();
    const drag = new TokenDrag(
      "s1",
      "goblin",
      { col: 2, row: 3 },
      (d) => {
        if (live) sentLive.push(d); // sendSignal drops while not live, never queues
      },
      clock.timers,
    );
    drag.move(1, 1);
    live = false;
    drag.move(2, 2);
    clock.advance(3000);
    let moved = false;
    expect(drag.finish({ col: 5, row: 3 }, false, () => (moved = true))).toEqual({
      col: 2,
      row: 3,
    });
    expect(moved).toBe(false);
    expect(sentLive).toEqual([{ sceneId: "s1", tokenId: "goblin", x: 1, y: 1 }]);
  });

  test("FR-MAP-39 unmoved drop: no intent; `end` still clears others' previews", () => {
    const { drag, sent, sendMove } = setup();
    drag.move(141, 211);
    expect(drag.finish({ col: 2, row: 3 }, true, sendMove)).toEqual({ col: 2, row: 3 });
    expect(sent.some((d) => "intent" in d)).toBe(false);
    expect(sent.at(-1)).toMatchObject({ end: true });
  });
});

describe("FR-MAP-40 preview store", () => {
  const view = (over: Partial<PreviewView> = {}): PreviewView => ({
    sceneId: "s1",
    hasToken: (id) => id === "goblin" || id === "mira",
    draggingId: null,
    ...over,
  });
  const at = (tokenId: string, x = 10, sceneId = "s1"): DragData => ({
    sceneId,
    tokenId,
    x,
    y: 20,
  });

  test("FR-MAP-40 preview store: draws known tokens of the shown scene only", () => {
    const s = createPreviewStore();
    receiveDrag(s, at("goblin"), view(), 0);
    receiveDrag(s, at("mira", 10, "other-scene"), view(), 0);
    receiveDrag(s, at("unknown"), view(), 0);
    receiveDrag(s, at("mira"), view({ sceneId: null }), 0);
    expect(s.getState().previews).toEqual({ goblin: { x: 10, y: 20, at: 0 } });
    receiveDrag(s, at("goblin", 30), view(), 100);
    expect(s.getState().previews.goblin).toEqual({ x: 30, y: 20, at: 100 });
  });

  test("FR-MAP-40 preview store: own drag ignores others' previews of that token", () => {
    const s = createPreviewStore();
    receiveDrag(s, at("goblin"), view({ draggingId: "goblin" }), 0);
    receiveDrag(s, at("mira"), view({ draggingId: "goblin" }), 0);
    expect(Object.keys(s.getState().previews)).toEqual(["mira"]);
  });

  test("FR-MAP-40 preview store: cleared by `end`, token change, snapshot and 3 s", () => {
    const s = createPreviewStore();
    receiveDrag(s, at("goblin"), view(), 0);
    receiveDrag(s, at("mira"), view(), 0);
    receiveDrag(s, { sceneId: "other", tokenId: "goblin", end: true }, view(), 0);
    expect(Object.keys(s.getState().previews).sort()).toEqual(["goblin", "mira"]);
    receiveDrag(s, { sceneId: "s1", tokenId: "goblin", end: true }, view(), 0);
    expect(Object.keys(s.getState().previews)).toEqual(["mira"]);
    // A TokenMoved (any `token` change) for Mira.
    clearPreviews(
      s,
      tokenIdsOf([
        { type: "combatant", id: "mira" },
        { type: "token", id: "mira" },
      ]),
    );
    expect(s.getState().previews).toEqual({});
    // Snapshot: everything.
    receiveDrag(s, at("goblin"), view(), 0);
    receiveDrag(s, at("mira"), view(), 0);
    clearPreviews(s);
    expect(s.getState().previews).toEqual({});
    // 3 s without a frame: the preview drops; a 1 s repeat keeps it.
    receiveDrag(s, at("goblin"), view(), 0);
    receiveDrag(s, at("mira"), view(), 0);
    receiveDrag(s, at("mira"), view(), 1000);
    receiveDrag(s, at("mira"), view(), 2000);
    expect(prunePreviews(s, 2999)).toBe(true);
    expect(Object.keys(s.getState().previews).sort()).toEqual(["goblin", "mira"]);
    expect(prunePreviews(s, 3000)).toBe(true);
    expect(Object.keys(s.getState().previews)).toEqual(["mira"]);
    expect(prunePreviews(s, 5000)).toBe(false);
  });
});
