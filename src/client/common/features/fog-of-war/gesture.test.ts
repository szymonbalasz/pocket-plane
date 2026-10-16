// FOG §13 client unit rows: gestures per shape × snap / Ctrl (FR-FOG-18 rectangle, FR-FOG-19
// polygon, FR-FOG-41 circle + radius label), darkness select / move / remove (FR-FOG-42), keys,
// Esc and drops (FR-FOG-22), a pending draft until it settles.
import { describe, expect, test } from "bun:test";
import type { DarknessShape } from "@shared/fog-of-war/shapes";
import {
  circleRadius,
  edgeCrosses,
  type GestureMode,
  type GesturePoint,
  type GestureState,
  type GestureStep,
  gestureCancel,
  gestureDown,
  gestureKey,
  gestureMove,
  gestureSettled,
  gestureUp,
  idleGesture,
  type PolygonDraft,
  radiusLabel,
  snap,
} from "./gesture";

const CELL = 70;
/** A pointer at grid point (x, y); screen px = map px (no pan, zoom 1). */
const pt = (x: number, y: number, o: { ctrl?: boolean; clicks?: number } = {}): GesturePoint => ({
  at: [x, y],
  cell: { col: Math.floor(x), row: Math.floor(y) },
  screen: { x: x * CELL, y: y * CELL },
  clicks: o.clicks ?? 1,
  ctrl: o.ctrl ?? false,
});
const rect: GestureMode = { shape: "rect", darkness: null };
const circle: GestureMode = { shape: "circle", darkness: null };
const polygon: GestureMode = { shape: "polygon", darkness: null };

/** Press, moves, release through the same points. */
function drag(m: GestureMode, pts: GesturePoint[], s: GestureState = idleGesture): GestureStep {
  let st = gestureDown(s, m, pts[0] as GesturePoint).state;
  for (const p of pts.slice(1)) st = gestureMove(st, m, p).state;
  return gestureUp(st, m, pts.at(-1) as GesturePoint);
}
/** A click (press + release, no travel). */
const click = (s: GestureState, m: GestureMode, p: GesturePoint) =>
  gestureUp(gestureDown(s, m, p).state, m, p);

describe("FR-FOG-18 rectangle", () => {
  test("FR-FOG-18 corners snap to the nearest grid corner; release sends the rect; the draft stays pending", () => {
    const step = drag(rect, [pt(11.2, 5.4), pt(12.6, 6.1), pt(13.7, 7.8)]);
    expect(step.send).toEqual({ kind: "shape", shape: { rect: [11, 5, 14, 8] } });
    expect(step.state).toMatchObject({ pending: true, draft: { kind: "rect", free: false } });
    expect(gestureSettled(step.state, step.state.draft)).toMatchObject({
      draft: null,
      pending: false,
    });
  });

  test("FR-FOG-18 Ctrl (read on every move) → free corners rounded to 0.01", () => {
    let s = gestureDown(idleGesture, rect, pt(15.333, 10.204, { ctrl: true })).state;
    expect(s.draft).toMatchObject({ a: [15.33, 10.2], free: true });
    s = gestureMove(s, rect, pt(18.6, 12.71, { ctrl: false })).state;
    expect(s.draft).toMatchObject({ b: [19, 13], free: false });
    s = gestureMove(s, rect, pt(18.6, 12.71, { ctrl: true })).state;
    expect(s.draft).toMatchObject({ b: [18.6, 12.71], free: true });
    expect(s.free).toBe(true);
    expect(gestureUp(s, rect, pt(18.6, 12.71, { ctrl: true })).send).toEqual({
      kind: "shape",
      shape: { rect: [15.33, 10.2, 18.6, 12.71] },
    });
  });

  test("FR-FOG-18 < 4 px = the cell under the press; a drag that snaps to no area too", () => {
    expect(click(idleGesture, rect, pt(2.4, 2.6)).send).toEqual({
      kind: "shape",
      shape: { rect: [2, 2, 3, 3] },
    });
    expect(drag(rect, [pt(2.1, 2.1), pt(2.3, 4.2)]).send).toEqual({
      kind: "shape",
      shape: { rect: [2, 2, 3, 3] },
    });
  });
});

describe("FR-FOG-41 circle", () => {
  test("FR-FOG-41 press = centre (snapped), drag = radius in whole cells, label '15 ft'; < 4 px → 1 cell", () => {
    const step = drag(circle, [pt(12.4, 6.4), pt(14.4, 7.6), pt(15.3, 6.6)]);
    expect(step.send).toEqual({ kind: "shape", shape: { circle: [12, 6, 3] } });
    expect(radiusLabel(3, false)).toBe("15 ft");
    expect(click(idleGesture, circle, pt(5.2, 5.2)).send).toEqual({
      kind: "shape",
      shape: { circle: [5, 5, 1] },
    });
    // Never under one cell while snapped; capped at 60.
    expect(circleRadius([0, 0], [0.2, 0], false)).toBe(1);
    expect(circleRadius([0, 0], [100, 0], false)).toBe(60);
  });

  test("FR-FOG-41 Ctrl: free centre and radius (0.01), label rounded to ft (≈ 11 ft for 2.2 cells)", () => {
    let s = gestureDown(idleGesture, circle, pt(16.4, 3.7, { ctrl: true })).state;
    s = gestureMove(s, circle, pt(18.6, 3.7, { ctrl: true })).state;
    expect(s.draft).toMatchObject({ kind: "circle", c: [16.4, 3.7], r: 2.2, free: true });
    expect(radiusLabel(2.2, true)).toBe("≈ 11 ft");
    expect(radiusLabel(3, true)).toBe("≈ 15 ft");
    expect(gestureUp(s, circle, pt(18.6, 3.7, { ctrl: true })).send).toEqual({
      kind: "shape",
      shape: { circle: [16.4, 3.7, 2.2] },
    });
    // Free radius floor 0.5 (FR-FOG-26).
    expect(circleRadius([0, 0], [0.1, 0], true)).toBe(0.5);
  });
});

describe("FR-FOG-19 polygon", () => {
  const clicks = (pts: GesturePoint[], s: GestureState = idleGesture) => {
    let st = s;
    let last: GestureStep = { state: st };
    for (const p of pts) {
      last = click(st, polygon, p);
      st = last.state;
    }
    return last;
  };

  test("FR-FOG-19 Ctrl-clicks place free vertices (attr `free`); a click on the first vertex closes (≥ 3) and sends", () => {
    const free = { ctrl: true };
    const open = clicks([
      pt(15.3, 10.2, free),
      pt(18.6, 10.2, free),
      pt(18.6, 12.7, free),
      pt(15.3, 12.7, free),
    ]);
    expect(open.send).toBeUndefined();
    expect(open.state.draft).toMatchObject({ kind: "polygon" });
    const draft = open.state.draft as PolygonDraft;
    expect(draft.points.map((v) => [v.p, v.free])).toEqual([
      [[15.3, 10.2], true],
      [[18.6, 10.2], true],
      [[18.6, 12.7], true],
      [[15.3, 12.7], true],
    ]);
    // A plain click near the first vertex (its snapped corner (15, 10) differs) closes.
    const closed = click(open.state, polygon, pt(15.32, 10.21));
    expect(closed.send).toEqual({
      kind: "shape",
      shape: { polygon: [15.3, 10.2, 18.6, 10.2, 18.6, 12.7, 15.3, 12.7] },
    });
    expect(closed.state.pending).toBe(true);
  });

  test("FR-FOG-19 snapped vertices; < 4 px from the last ignored; Backspace drops one; Enter / double-click close", () => {
    let s = clicks([pt(1.1, 1.2), pt(4.2, 0.8)]).state;
    expect((s.draft as PolygonDraft).points).toHaveLength(2);
    // Same corner again / within 4 px: ignored.
    s = click(s, polygon, pt(4.22, 0.81)).state;
    expect((s.draft as PolygonDraft).points).toHaveLength(2);
    s = click(s, polygon, pt(4, 4)).state;
    s = (gestureKey(s, "Backspace") as GestureStep).state;
    expect((s.draft as PolygonDraft).points).toHaveLength(2);
    expect(gestureKey(s, "Enter")?.send).toBeUndefined(); // < 3 vertices: nothing
    s = click(s, polygon, pt(4, 4)).state;
    expect(gestureKey(s, "Enter")?.send).toEqual({
      kind: "shape",
      shape: { polygon: [1, 1, 4, 1, 4, 4] },
    });
    expect(click(s, polygon, pt(1.6, 3.9, { clicks: 2 })).send).toMatchObject({ kind: "shape" });
  });

  test("FR-FOG-19 crossing refused with a hint (exact on decimals); 64 vertices max", () => {
    const s = clicks([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)]).state;
    expect(click(s, polygon, pt(6, 2))).toMatchObject({ hint: "crossing" });
    expect(
      edgeCrosses(
        [
          [0, 0],
          [4.1, 0.1],
          [4.1, 4.3],
        ],
        [2.05, -1],
      ),
    ).toBe(true);
    let many: GestureState = idleGesture;
    for (let k = 0; k < 64; k++) {
      const a = (2 * Math.PI * k) / 64;
      many = click(
        many,
        polygon,
        pt(50 + 40 * Math.cos(a), 50 + 40 * Math.sin(a), { ctrl: true }),
      ).state;
    }
    expect(click(many, polygon, pt(50, 50, { ctrl: true }))).toMatchObject({ hint: "max" });
  });

  test("FR-FOG-19 a drag adds nothing", () => {
    const s = drag(polygon, [pt(1, 1), pt(3, 3)]);
    expect(s.state.draft).toBeNull();
    expect(snap([1.234, 5.678], true)).toEqual([1.23, 5.68]);
    expect(snap([1.4, 5.6], false)).toEqual([1, 6]);
  });
});

describe("FR-FOG-42 darkness editing", () => {
  const darkness: DarknessShape[] = [
    { id: "d1", circle: [12.5, 9, 1.5] },
    { id: "d2", rect: [2, 2, 4, 4] },
  ];
  const dark: GestureMode = { shape: "circle", darkness };

  test("FR-FOG-42 a press on a shape selects it; a click keeps the selection and sends nothing", () => {
    const step = click(idleGesture, dark, pt(12.6, 9.2));
    expect(step.send).toBeUndefined();
    expect(step.state).toMatchObject({ selected: "d1", move: null, draft: null });
  });

  test("FR-FOG-42 drag moves by whole cells (free with Ctrl) → move on release; pending until settled", () => {
    const step = drag(dark, [pt(3, 3), pt(4.4, 3.2), pt(5.6, 2.4)]);
    expect(step.send).toEqual({ kind: "move", id: "d2", dx: 3, dy: -1 });
    expect(step.state.move).toMatchObject({ id: "d2", dx: 3, dy: -1, pending: true });
    expect(gestureSettled(step.state, step.state.move).move).toBeNull();
    const free = drag(dark, [pt(3, 3, { ctrl: true }), pt(4.234, 3.5, { ctrl: true })]);
    expect(free.send).toEqual({ kind: "move", id: "d2", dx: 1.23, dy: 0.5 });
  });

  test("FR-FOG-42 drawing starts only on empty space (and deselects); Delete / Backspace removes the selected one", () => {
    let s = click(idleGesture, dark, pt(3, 3)).state;
    expect(s.selected).toBe("d2");
    const removed = gestureKey(s, "Delete") as GestureStep;
    expect(removed.send).toEqual({ kind: "remove", id: "d2" });
    expect(removed.state.selected).toBeNull();
    expect(gestureKey(s, "Backspace")?.send).toEqual({ kind: "remove", id: "d2" });
    s = gestureDown(s, dark, pt(8, 8)).state;
    expect(s).toMatchObject({ selected: null, draft: { kind: "circle", c: [8, 8] } });
    expect(gestureKey(idleGesture, "Delete")).toBeNull();
  });

  test("FR-FOG-42 / -22 Esc drops a drag, then the selection; leaving live drops all", () => {
    let s = gestureDown(idleGesture, dark, pt(3, 3)).state;
    s = gestureMove(s, dark, pt(5, 5)).state;
    const esc = gestureCancel(s, "escape");
    expect(esc).toMatchObject({ dropped: true, state: { move: null, selected: "d2" } });
    const esc2 = gestureCancel(esc.state, "escape");
    expect(esc2).toMatchObject({ dropped: true, state: { selected: null } });
    expect(gestureCancel(esc2.state, "escape").dropped).toBe(false);
    expect(gestureCancel(s, "live").state).toEqual(idleGesture);
  });
});

describe("FR-FOG-22 drops", () => {
  test("FR-FOG-22 Esc drops a draft in progress but keeps a pending one until it settles", () => {
    const s = gestureDown(idleGesture, rect, pt(1, 1)).state;
    expect(gestureCancel(s, "escape")).toEqual({ state: idleGesture, dropped: true });
    const sent = drag(rect, [pt(1, 1), pt(3, 3)]).state;
    const kept = gestureCancel({ ...sent, selected: null }, "escape");
    expect(kept.dropped).toBe(false);
    expect(kept.state.draft).toEqual(sent.draft);
    for (const reason of ["scene", "tool", "live", "unmount"] as const) {
      expect(gestureCancel(s, reason)).toEqual({ state: idleGesture, dropped: true });
    }
  });
});
