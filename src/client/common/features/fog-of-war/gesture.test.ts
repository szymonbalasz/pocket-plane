// FOG §13 client unit rows: FR-FOG-17–19 gestures per mode and FR-FOG-22 drops (the pure machine).
import { describe, expect, test } from "bun:test";
import { FOG_VERTICES_MAX } from "@shared/fog-of-war/schemas";
import {
  type Corner,
  closePolygon,
  edgeCrosses,
  type GesturePoint,
  type GestureState,
  gestureCancel,
  gestureDown,
  gestureKey,
  gestureMove,
  gestureSettled,
  gestureUp,
  idleGesture,
} from "./gesture";

/** A point over cell (col, row), corner (i, j), at screen (x, y). */
const pt = (
  col: number,
  row: number,
  screen: [number, number],
  vertex: [number, number] = [col, row],
  clicks = 1,
): GesturePoint => ({
  cell: { col, row },
  vertex: { x: vertex[0], y: vertex[1] },
  screen: { x: screen[0], y: screen[1] },
  clicks,
});

/** A polygon click at corner (i, j), screen px 70 per corner. */
function click(s: GestureState, i: number, j: number, clicks = 1) {
  const p = pt(i, j, [i * 70, j * 70], [i, j], clicks);
  const down = gestureDown(s, "polygon", p).state;
  return gestureUp(down, "polygon", p);
}

function clicks(corners: Corner[]): GestureState {
  let s = idleGesture;
  for (const [i, j] of corners) s = click(s, i, j).state;
  return s;
}

describe("FR-FOG-18 rectangle", () => {
  test("FR-FOG-18 left-drag draws cell to cell; the draft follows; release sends; stays pending", () => {
    let s = gestureDown(idleGesture, "rect", pt(11, 5, [100, 100])).state;
    expect(s.draft).toEqual({ kind: "rect", c0: 11, r0: 5, c1: 11, r1: 5 });
    s = gestureMove(s, "rect", pt(12, 6, [170, 170])).state;
    s = gestureMove(s, "rect", pt(13, 7, [240, 240])).state;
    expect(s.draft).toEqual({ kind: "rect", c0: 11, r0: 5, c1: 13, r1: 7 });
    const up = gestureUp(s, "rect", pt(13, 7, [240, 240]));
    expect(up.send).toEqual({ kind: "rect", c0: 11, r0: 5, c1: 13, r1: 7 });
    expect(up.state.pending).toBe(true);
    expect(up.state.draft).toEqual({ kind: "rect", c0: 11, r0: 5, c1: 13, r1: 7 });
    // The draft stays until the event or reject, then goes.
    expect(gestureSettled(up.state, up.state.draft)).toMatchObject({ draft: null, pending: false });
  });

  test("FR-FOG-18 < 4 px = that one cell (the press cell)", () => {
    const s = gestureDown(idleGesture, "rect", pt(4, 4, [100, 100])).state;
    const up = gestureUp(s, "rect", pt(5, 4, [103, 101]));
    expect(up.send).toEqual({ kind: "rect", c0: 4, r0: 4, c1: 4, r1: 4 });
  });

  test("FR-FOG-18 dragging up-left sends the cells either way (the server normalises)", () => {
    const s = gestureDown(idleGesture, "rect", pt(8, 8, [500, 500])).state;
    expect(gestureUp(s, "rect", pt(6, 7, [360, 430])).send).toEqual({
      kind: "rect",
      c0: 8,
      r0: 8,
      c1: 6,
      r1: 7,
    });
  });

  test("FR-FOG-18 Esc cancels mid-drag (dropped); a move without a press does nothing", () => {
    expect(gestureMove(idleGesture, "rect", pt(1, 1, [0, 0])).state).toBe(idleGesture);
    const s = gestureDown(idleGesture, "rect", pt(1, 1, [0, 0])).state;
    const c = gestureCancel(s, "escape");
    expect(c).toEqual({ state: idleGesture, dropped: true });
    expect(gestureUp(c.state, "rect", pt(3, 3, [200, 200])).send).toBeUndefined();
  });

  test("FR-FOG-18 a pending draft survives Esc (nothing in progress); a new press replaces it", () => {
    const sent = gestureUp(
      gestureDown(idleGesture, "rect", pt(1, 1, [0, 0])).state,
      "rect",
      pt(1, 1, [0, 0]),
    ).state;
    expect(gestureCancel(sent, "escape")).toEqual({ state: sent, dropped: false });
    const next = gestureDown(sent, "rect", pt(5, 5, [300, 300])).state;
    expect(next).toMatchObject({ pending: false, draft: { c0: 5, r0: 5 } });
    // The old send settling leaves the newer draft alone.
    expect(gestureSettled(next, sent.draft)).toBe(next);
  });
});

describe("FR-FOG-19 polygon", () => {
  test("FR-FOG-19 clicks add corners; a click on the first corner closes (≥ 3) and sends", () => {
    let s = clicks([
      [15, 10],
      [19, 10],
      [19, 13],
      [15, 13],
    ]);
    expect(s.draft).toMatchObject({
      kind: "polygon",
      points: [
        [15, 10],
        [19, 10],
        [19, 13],
        [15, 13],
      ],
    });
    const close = click(s, 15, 10);
    expect(close.send).toEqual({
      kind: "polygon",
      points: [
        [15, 10],
        [19, 10],
        [19, 13],
        [15, 13],
      ],
    });
    s = close.state;
    expect(s.pending).toBe(true);
  });

  test("FR-FOG-19 Enter and double-click close; < 3 corners do not", () => {
    const two = clicks([
      [0, 0],
      [3, 0],
    ]);
    expect(gestureKey(two, "Enter")?.send).toBeUndefined();
    const three = click(two, 0, 3).state;
    expect(gestureKey(three, "Enter")?.send).toMatchObject({ kind: "polygon" });
    // Double-click: the first click adds (0, 3), the second (clicks = 2) closes without adding.
    const dbl = click(click(two, 0, 3).state, 0, 3, 2);
    expect(dbl.send).toEqual({
      kind: "polygon",
      points: [
        [0, 0],
        [3, 0],
        [0, 3],
      ],
    });
  });

  test("FR-FOG-19 Backspace drops the last corner; on an empty polygon it isn't handled", () => {
    const s = clicks([
      [0, 0],
      [3, 0],
    ]);
    const back = gestureKey(s, "Backspace");
    expect(back?.state.draft).toMatchObject({ points: [[0, 0]] });
    const empty = gestureKey(back?.state as GestureState, "Backspace");
    expect(empty?.state.draft).toBeNull();
    expect(gestureKey(idleGesture, "Backspace")).toBeNull();
    expect(gestureKey(idleGesture, "a")).toBeNull();
  });

  test("FR-FOG-19 a click < 4 px from the last one, or on the last corner, is ignored", () => {
    const s = clicks([[2, 2]]);
    // Same corner.
    expect(click(s, 2, 2).state.draft).toMatchObject({ points: [[2, 2]] });
    // A different corner, but < 4 screen px from the last click.
    const near = pt(3, 2, [2 * 70 + 3, 2 * 70], [3, 2]);
    const up = gestureUp(gestureDown(s, "polygon", near).state, "polygon", near);
    expect(up.state.draft).toMatchObject({ points: [[2, 2]] });
  });

  test("FR-FOG-19 a corner whose edge would cross another is refused ('Edges can't cross')", () => {
    // A zig-zag: (0,0) → (4,0) → (0,4) → (4,4); closing back through (0,0) is fine, but a corner
    // at (2,-1) from (4,4) crosses the first edges.
    const s = clicks([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]);
    const cross = click(s, 6, 2);
    expect(cross.hint).toBe("crossing");
    expect(cross.state.draft).toMatchObject({ points: { length: 4 } });
    // Doubling back along the last edge also crosses.
    const line = clicks([
      [0, 0],
      [4, 0],
    ]);
    expect(click(line, 2, 0).hint).toBe("crossing");
    expect(
      edgeCrosses(
        [
          [0, 0],
          [4, 0],
          [4, 4],
        ],
        [2, -2],
      ),
    ).toBe(true);
    expect(
      edgeCrosses(
        [
          [0, 0],
          [4, 0],
          [4, 4],
        ],
        [0, 4],
      ),
    ).toBe(false);
  });

  test("FR-FOG-19 closing a polygon whose closing edge would cross is refused", () => {
    const s = clicks([
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
    ]);
    // (0,4) → (0,0) closes a bow tie: (0,0)–(4,4) crosses (4,0)–(0,4) only once closed. That
    // crossing was refused when (0,4) was clicked, so the chain stops at 3 corners.
    expect(s.draft).toMatchObject({ points: { length: 3 } });
    // An open chain that is fine until the closing edge (6, 2) → (0, 0) cuts (4, 0)–(4, 4).
    const hook = clicks([
      [0, 0],
      [4, 0],
      [4, 4],
      [6, 4],
      [6, 2],
    ]);
    expect(hook.draft).toMatchObject({ points: { length: 5 } });
    const closing = click(hook, 0, 0);
    expect(closing.hint).toBe("crossing");
    expect(closing.send).toBeUndefined();
    expect(closePolygon(hook).hint).toBe("crossing");
  });

  test(`FR-FOG-19 ${FOG_VERTICES_MAX} corners at most`, () => {
    // A staircase of 64 corners along a convex arc: no crossing.
    const corners: Corner[] = [];
    for (let k = 0; k < FOG_VERTICES_MAX; k++) corners.push([k * 10, k * k]);
    const s = clicks(corners);
    expect(s.draft).toMatchObject({ points: { length: FOG_VERTICES_MAX } });
    expect(click(s, 0, 4000).hint).toBe("max");
  });

  test("FR-FOG-17 polygon: a drag adds nothing (pan); the rubber band follows the pointer", () => {
    const s = clicks([[1, 1]]);
    const down = gestureDown(s, "polygon", pt(5, 5, [350, 350], [5, 5])).state;
    const up = gestureUp(down, "polygon", pt(9, 9, [630, 630], [9, 9]));
    expect(up.state.draft).toMatchObject({ points: [[1, 1]] });
    const hover = gestureMove(up.state, "polygon", pt(3, 1, [210, 70], [3, 1])).state;
    expect(hover.draft).toMatchObject({ hover: [3, 1] });
    // Unchanged corner → the same state (no re-render).
    expect(gestureMove(hover, "polygon", pt(3, 1, [212, 72], [3, 1])).state).toBe(hover);
  });

  test("FR-FOG-19 Esc cancels the polygon in progress", () => {
    const s = clicks([
      [0, 0],
      [3, 0],
    ]);
    expect(gestureCancel(s, "escape")).toEqual({ state: idleGesture, dropped: true });
    expect(gestureCancel(idleGesture, "escape").dropped).toBe(false);
  });
});

describe("FR-FOG-22 dropped gestures", () => {
  test("FR-FOG-22 leaving live, a scene switch, a tool switch drop the gesture, sent drafts too", () => {
    const drawing = clicks([
      [0, 0],
      [3, 0],
    ]);
    const pressed = gestureDown(idleGesture, "rect", pt(1, 1, [0, 0])).state;
    const sent = gestureUp(pressed, "rect", pt(1, 1, [0, 0])).state;
    for (const reason of ["live", "scene", "tool", "unmount"] as const) {
      expect(gestureCancel(drawing, reason)).toEqual({ state: idleGesture, dropped: true });
      expect(gestureCancel(pressed, reason)).toEqual({ state: idleGesture, dropped: true });
      expect(gestureCancel(sent, reason)).toEqual({ state: idleGesture, dropped: false });
    }
  });
});
