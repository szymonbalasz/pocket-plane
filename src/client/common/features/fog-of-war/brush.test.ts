// FOG §13 sprint-4 client unit rows (V9): FR-FOG-55 brush stamps (0 / 5 / 10 ft by 5/10/5 and by
// "5"), the free radius, the path walk (no gaps), simplification, the 256-point and 128 × 128
// splits, Esc; the gesture (one stroke = one send, completed strokes sent mid-drag, sent strokes
// drawn until they settle) and the store (one `fog.edit` per stroke in the bar's mode; no Darkness
// brush; the radius kept per browser).
import { afterEach, describe, expect, test } from "bun:test";
import { CELLS_BOX_MAX, paintedCells, STROKE_POINTS_MAX } from "@shared/fog-of-war/brush";
import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import { FogBrushGeom, shapeContains } from "@shared/fog-of-war/shapes";
import type { SceneView } from "@shared/scenes-map/schemas";
import type { ToolPointer } from "../scenes-map/tools";
import {
  BRUSH_FT,
  brushShape,
  clampBrushFt,
  extendBrush,
  freeRadius,
  simplifyPath,
  stampCells,
  startBrush,
} from "./brush";
import {
  type GestureMode,
  type GesturePoint,
  gestureCancel,
  gestureDown,
  gestureMove,
  gestureSettled,
  gestureUp,
  idleGesture,
} from "./gesture";
import {
  BRUSH_FT_KEY,
  fogPointer,
  setBrushFt,
  setFogMode,
  setFogReader,
  useFogTool,
} from "./store";

const sortCells = (c: readonly (readonly [number, number])[]) =>
  [...c].map(([a, b]) => `${a},${b}`).sort();

describe("FR-FOG-55 snapped stamps", () => {
  test("FR-FOG-55 0 ft = that cell, 5 ft = 3 × 3, 10 ft = the 5/10/5 diamond-ish disc; rule '5' = squares", () => {
    expect(stampCells(4, 4, 0, "5-10-5")).toEqual([[4, 4]]);
    expect(sortCells(stampCells(4, 4, 5, "5-10-5"))).toHaveLength(9);
    // 10 ft by 5/10/5: (±2, ±1) cost 5 + 10 = 15 > 10 → out; (±1, ±1) = 5 in; (±2, 0) = 10 in.
    const ten = stampCells(4, 4, 10, "5-10-5");
    expect(ten).toHaveLength(21);
    expect(sortCells(ten)).toContain("6,4");
    expect(sortCells(ten)).toContain("5,5");
    expect(sortCells(ten)).not.toContain("6,6");
    expect(sortCells(ten)).toContain("6,5");
    // Rule "5": every diagonal 5 ft → a 5 × 5 square.
    expect(stampCells(4, 4, 10, "5")).toHaveLength(25);
  });

  test("FR-FOG-55 a drag stamps every cell it visits (a fast move leaves no gap) and sends one cells shape", () => {
    let d = startBrush([2.5, 2.5], 0, false, "5-10-5");
    d = extendBrush(d, [8.5, 2.5]).draft; // one jump of 6 cells
    expect(sortCells(d.cells)).toEqual(
      sortCells([2, 3, 4, 5, 6, 7, 8].map((c) => [c, 2] as [number, number])),
    );
    const shape = brushShape(d);
    expect(shape).toEqual({ cells: { box: [2, 2, 7, 1], runs: "7" } });
    expect(FogBrushGeom.safeParse(shape).success).toBe(true);
  });

  test("FR-FOG-55 a snapped stroke leaving the 128 × 128 box is sent and a new one starts", () => {
    let d = startBrush([0.5, 0.5], 0, false, "5-10-5");
    const { draft, sent } = extendBrush(d, [CELLS_BOX_MAX + 4.5, 0.5]);
    expect(sent).toHaveLength(1);
    const first = brushShape(sent[0] as typeof d);
    expect(first && "cells" in first && first.cells.box).toEqual([0, 0, CELLS_BOX_MAX, 1]);
    expect(sortCells(draft.cells)).toEqual(
      sortCells([0, 1, 2, 3, 4].map((k) => [CELLS_BOX_MAX + k, 0] as [number, number])),
    );
    d = draft;
    expect(FogBrushGeom.safeParse(brushShape(d)).success).toBe(true);
  });
});

describe("FR-FOG-55 free strokes", () => {
  test("FR-FOG-55 free radius max(0.5, ft / 5); points ≥ 0.25 cell apart; simplified to 0.05 before sending", () => {
    expect(freeRadius(0)).toBe(0.5);
    expect(freeRadius(10)).toBe(2);
    expect(freeRadius(50)).toBe(10);
    let d = startBrush([1.234, 1.0], 10, true, "5-10-5");
    expect(d.points).toEqual([[1.23, 1]]);
    d = extendBrush(d, [1.3, 1.0]).draft; // < 0.25 away: dropped
    expect(d.points).toHaveLength(1);
    for (let x = 1.6; x <= 5; x += 0.4) d = extendBrush(d, [x, 1.0 + (x > 3 ? 0.01 : 0)]).draft;
    const shape = brushShape(d);
    expect(shape && "stroke" in shape).toBe(true);
    const stroke = (shape as { stroke: number[] }).stroke;
    expect(stroke[0]).toBe(2);
    // A nearly straight line keeps only its ends (and maybe the kink) after simplification.
    expect((stroke.length - 1) / 2).toBeLessThanOrEqual(3);
    expect(FogBrushGeom.safeParse(shape).success).toBe(true);
    expect(shapeContains(shape as { stroke: number[] }, 3, 2.9)).toBe(true);
    expect(shapeContains(shape as { stroke: number[] }, 3, 3.1)).toBe(false);
  });

  test("FR-FOG-55 simplifyPath keeps the ends and every point farther than 0.05 cell from the chord", () => {
    expect(simplifyPath([[0, 0]])).toEqual([[0, 0]]);
    expect(
      simplifyPath([
        [0, 0],
        [1, 0.04],
        [2, 0],
      ]),
    ).toEqual([
      [0, 0],
      [2, 0],
    ]);
    expect(
      simplifyPath([
        [0, 0],
        [1, 0.06],
        [2, 0],
      ]),
    ).toHaveLength(3);
  });

  test("FR-FOG-55 a free stroke reaching 256 points is sent and a new one starts from its last point", () => {
    let d = startBrush([0, 0], 5, true, "5-10-5");
    const sent = [];
    // A zig-zag (nothing simplifies away), 0.5 cell steps.
    for (let i = 1; i < STROKE_POINTS_MAX + 10; i++) {
      const step = extendBrush(d, [i * 0.5, i % 2 === 0 ? 0 : 1]);
      d = step.draft;
      sent.push(...step.sent);
    }
    expect(sent).toHaveLength(1);
    const first = sent[0] as typeof d;
    expect(first.points).toHaveLength(STROKE_POINTS_MAX);
    expect(d.points[0]).toEqual(first.points.at(-1));
    expect(FogBrushGeom.safeParse(brushShape(first)).success).toBe(true);
  });

  test("FR-FOG-55 the radius Slider value: 0–50 ft, step 5, default 10", () => {
    expect(BRUSH_FT).toEqual({ min: 0, max: 50, step: 5, default: 10 });
    expect(clampBrushFt("15")).toBe(15);
    expect(clampBrushFt(13)).toBe(15);
    expect(clampBrushFt(80)).toBe(50);
    expect(clampBrushFt(-5)).toBe(0);
    expect(clampBrushFt("x")).toBe(10);
  });
});

const pt = (x: number, y: number, ctrl = false): GesturePoint => ({
  at: [x, y],
  cell: { col: Math.floor(x), row: Math.floor(y) },
  screen: { x: x * 70, y: y * 70 },
  clicks: 1,
  ctrl,
});
const brushMode = (ft = 10): GestureMode => ({
  shape: "brush",
  darkness: null,
  brush: { ft, rule: "5-10-5" },
});

describe("FR-FOG-55 brush gesture", () => {
  test("FR-FOG-55 press + drag + release = one stroke sent; Ctrl at the press = free for the whole stroke", () => {
    const m = brushMode(0);
    let s = gestureDown(idleGesture, m, pt(14.5, 2.5)).state;
    expect(s.draft).toMatchObject({ kind: "brush", free: false });
    s = gestureMove(s, m, pt(18.5, 2.5, true)).state; // Ctrl mid-stroke: still snapped
    const up = gestureUp(s, m, pt(18.5, 2.5));
    expect(up.send).toEqual({
      kind: "brush",
      strokes: [
        {
          draft: expect.objectContaining({ kind: "brush" }),
          shape: { cells: { box: [14, 2, 5, 1], runs: "5" } },
        },
      ],
    });
    expect(up.state.draft).toBeNull();
    expect(up.state.strokes).toHaveLength(1);
    // The stroke stays drawn until its event / reject; a new stroke may start meanwhile.
    const again = gestureDown(up.state, m, pt(3.5, 3.5, true)).state;
    expect(again.draft).toMatchObject({ kind: "brush", free: true });
    expect(again.strokes).toHaveLength(1);
    const settled = gestureSettled(again, up.state.strokes[0] ?? null);
    expect(settled.strokes).toEqual([]);
    expect(settled.draft).toBe(again.draft);
  });

  test("FR-FOG-55 Esc cancels the stroke being painted (nothing sent), sent strokes stay until they settle", () => {
    const m = brushMode(5);
    const sentOne = gestureUp(gestureDown(idleGesture, m, pt(1.5, 1.5)).state, m, pt(1.5, 1.5));
    let s = gestureDown(sentOne.state, m, pt(6.5, 6.5)).state;
    s = gestureMove(s, m, pt(9.5, 6.5)).state;
    const c = gestureCancel(s, "escape");
    expect(c.dropped).toBe(true);
    expect(c.state.draft).toBeNull();
    expect(c.state.press).toBeNull();
    expect(c.state.strokes).toHaveLength(1);
    // A release after Esc sends nothing.
    expect(gestureUp(c.state, m, pt(9.5, 6.5)).send).toBeUndefined();
    // Another tool / scene / leaving live drops everything.
    expect(gestureCancel(s, "tool").state).toEqual(idleGesture);
  });

  test("FR-FOG-55 a drag past 128 cells sends the full stroke mid-drag and keeps painting", () => {
    const m = brushMode(0);
    const s = gestureDown(idleGesture, m, pt(0.5, 0.5)).state;
    const mv = gestureMove(s, m, pt(CELLS_BOX_MAX + 2.5, 0.5));
    expect(mv.send?.kind).toBe("brush");
    expect(mv.state.strokes).toHaveLength(1);
    expect(mv.state.draft).toMatchObject({ kind: "brush" });
    const up = gestureUp(mv.state, m, pt(CELLS_BOX_MAX + 2.5, 0.5));
    expect(up.state.strokes).toHaveLength(2);
  });
});

interface Sent {
  name: string;
  input: unknown;
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

function pointer(sent: Sent[]) {
  const intent = (name: string, input: unknown) =>
    new Promise<unknown>((resolve, reject) => sent.push({ name, input, resolve, reject }));
  return (x: number, y: number, o: Partial<ToolPointer> = {}) =>
    ({
      x: x * 70,
      y: y * 70,
      cell: { col: Math.floor(x), row: Math.floor(y) },
      vertex: { x: Math.round(x), y: Math.round(y) },
      screen: { x: x * 70, y: y * 70 },
      button: 0,
      ctrl: false,
      shift: false,
      alt: false,
      clicks: 1,
      client: "dm",
      scene: { id: "scene-1" } as SceneView,
      grid: { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 },
      intent,
      signal: () => {},
      ...o,
    }) satisfies ToolPointer;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  useFogTool.setState({
    mode: "reveal",
    shape: "rect",
    gesture: idleGesture,
    hint: null,
    menu: null,
    hover: null,
    brushFt: 10,
  });
  setFogReader(
    () => undefined,
    () => "5-10-5",
  );
});

describe("FR-FOG-55 brush tool (store)", () => {
  test("FR-FOG-55 each stroke is one fog.edit in the bar's mode (Fog + free stroke); the stroke settles on the ack", async () => {
    const sent: Sent[] = [];
    const at = pointer(sent);
    setFogMode({ mode: "fog", shape: "brush" });
    setBrushFt(10);
    fogPointer.move?.(at(15.5, 2.3));
    expect(useFogTool.getState().hover).toEqual([15.5, 2.3]);
    fogPointer.down?.(at(15.5, 2.3, { ctrl: true }));
    fogPointer.move?.(at(16.5, 2.45, { ctrl: true }));
    fogPointer.move?.(at(17.5, 2.6, { ctrl: true }));
    expect(sent).toHaveLength(0); // painted locally while dragging
    fogPointer.up?.(at(17.5, 2.6, { ctrl: true }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe(FOG_INTENTS.edit);
    expect(sent[0]?.input).toEqual({
      sceneId: "scene-1",
      op: "fog",
      shape: { stroke: [2, 15.5, 2.3, 17.5, 2.6] },
    });
    expect(useFogTool.getState().gesture.strokes).toHaveLength(1);
    sent[0]?.resolve({ editId: "e1" });
    await tick();
    expect(useFogTool.getState().gesture.strokes).toHaveLength(0);
  });

  test("FR-FOG-55 a rejected stroke is dropped and toasted", async () => {
    const sent: Sent[] = [];
    const at = pointer(sent);
    const errors: unknown[] = [];
    const { setFogRejectHandler } = await import("./store");
    setFogRejectHandler((e) => errors.push(e));
    setFogMode({ mode: "reveal", shape: "brush" });
    fogPointer.down?.(at(2.5, 2.5));
    fogPointer.up?.(at(2.5, 2.5));
    sent[0]?.reject(new Error("Fog too detailed"));
    await tick();
    expect(useFogTool.getState().gesture.strokes).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  test("FR-FOG-55 no Darkness brush: Darkness with Brush picked falls back to Rectangle; Brush in Darkness is refused", () => {
    setFogMode({ shape: "brush" });
    setFogMode({ mode: "darkness" });
    expect(useFogTool.getState()).toMatchObject({ mode: "darkness", shape: "rect" });
    setFogMode({ shape: "brush" });
    expect(useFogTool.getState().shape).toBe("rect");
    setFogMode({ mode: "reveal" });
    setFogMode({ shape: "brush" });
    expect(useFogTool.getState().shape).toBe("brush");
  });

  test("FR-FOG-55 the radius is kept per browser (localStorage) and survives a failing storage", () => {
    const mem = new Map<string, string>();
    const g = globalThis as { localStorage?: unknown };
    const saved = g.localStorage;
    g.localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => mem.set(k, v),
    };
    try {
      setBrushFt(25);
      expect(useFogTool.getState().brushFt).toBe(25);
      expect(mem.get(BRUSH_FT_KEY)).toBe("25");
      g.localStorage = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      };
      setBrushFt(35);
      expect(useFogTool.getState().brushFt).toBe(35);
    } finally {
      g.localStorage = saved;
    }
  });

  test("FR-FOG-55 snapped stroke painted cells match the stamps along the path (10 ft, 5/10/5)", () => {
    const sent: Sent[] = [];
    const at = pointer(sent);
    setFogMode({ mode: "reveal", shape: "brush" });
    fogPointer.down?.(at(14.5, 2.5));
    fogPointer.move?.(at(16.5, 2.5));
    fogPointer.move?.(at(18.5, 2.5));
    fogPointer.up?.(at(18.5, 2.5));
    expect(sent).toHaveLength(1);
    const input = sent[0]?.input as {
      shape: { cells: { box: [number, number, number, number]; runs: string } };
    };
    const shape = input.shape;
    const want = new Set<string>();
    for (let c = 14; c <= 18; c++)
      for (const [a, b] of stampCells(c, 2, 10, "5-10-5")) want.add(`${a},${b}`);
    expect(sortCells(paintedCells(shape.cells))).toEqual([...want].sort());
  });
});
