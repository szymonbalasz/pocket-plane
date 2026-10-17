// FR-MAP-12 (sprint 4) middle-mouse pan: the press table over every registered tool, the pan
// controller MapCanvas feeds in the capture phase (swallowed presses, autoscroll stopped, camera
// moved), a gesture kept across a pan, and OQ-MAP-45 (ignored while the left button is down).
import { afterEach, describe, expect, test } from "bun:test";
import type { SceneView } from "@shared/scenes-map/schemas";
import { idleGesture } from "../fog-of-war/gesture";
import { setFogMode, useFogTool } from "../fog-of-war/store";
import { fogTool } from "../fog-of-war/tool";
import { cameraOn } from "./camera";
import { canvasTools } from "./canvas-tools";
import { createMiddlePan, type PanPointerEvent } from "./middle-pan";
import { type CanvasToolDef, pointerIntent, type ToolPointer, toolsFor } from "./tools";

const LEFT = 1;
const MIDDLE = 4;

function ev(type: string, button: number, buttons: number, x = 0, y = 0) {
  const e = {
    type,
    button,
    buttons,
    clientX: x,
    clientY: y,
    prevented: false,
    stopped: false,
    preventDefault() {
      e.prevented = true;
    },
    stopPropagation() {
      e.stopped = true;
    },
  };
  return e satisfies PanPointerEvent;
}

function host(at = { x: 10, y: 20 }) {
  const log = {
    moves: [] as [number, number][],
    ends: [] as ({ x: number; y: number } | null)[],
    panning: [] as boolean[],
  };
  const pan = createMiddlePan({
    position: () => at,
    move: (x, y) => log.moves.push([x, y]),
    end: (a) => log.ends.push(a),
    panning: (on) => log.panning.push(on),
  });
  return { pan, log };
}

const state = (tool: CanvasToolDef | null) => ({ tool, space: false, live: true });

/** Every rail tool on both clients, base tools as `null` (MapCanvas handles those itself). */
const everyTool = (["dm", "player"] as const).flatMap((client) => [
  ...toolsFor(canvasTools, client).map((t) => ({ client, id: t.id, def: t as CanvasToolDef })),
  ...["select", "ruler", "ping"].map((id) => ({ client, id, def: null })),
]);

afterEach(() => useFogTool.setState({ mode: "reveal", shape: "rect", gesture: idleGesture }));

describe("FR-MAP-12 middle pan", () => {
  test("FR-MAP-12 middle pan: button 1 pans under every registered tool, never reaches a tool", () => {
    expect(everyTool.length).toBeGreaterThan(6);
    for (const { def } of everyTool) {
      for (const space of [false, true])
        for (const live of [false, true]) {
          const e = { button: 1, buttons: MIDDLE, space, live, panning: false };
          expect(pointerIntent(def, e)).toBe("pan");
        }
      // Left stays as before: the drawing tool's when live, else MapCanvas's own.
      const left = { button: 0, buttons: LEFT, space: false, live: true, panning: false };
      expect(pointerIntent(def, left)).toBe(def?.pointer ? "tool" : "canvas");
      expect(pointerIntent(def, { ...left, button: 2, buttons: 2 })).toBe("canvas");
    }
  });

  test("FR-MAP-12 middle pan: the press is swallowed, autoscroll stopped, the camera follows and is marked moved", () => {
    const { pan, log } = host();
    const down = ev("pointerdown", 1, MIDDLE, 100, 100);
    expect(pan.press(down, state(fogTool))).toBe("pan");
    expect(down.stopped).toBe(true);
    // A cancelled pointerdown would drop the mousedown; that one is cancelled instead.
    expect(down.prevented).toBe(false);
    const mouse = ev("mousedown", 1, MIDDLE, 100, 100);
    expect(pan.press(mouse, state(fogTool))).toBe("ignore");
    expect(mouse).toMatchObject({ stopped: true, prevented: true });
    expect(pan.active).toBe(true);
    expect(log.panning).toEqual([true]);
    pan.move({ clientX: 130, clientY: 90 });
    pan.move({ clientX: 160, clientY: 140 });
    expect(log.moves).toEqual([
      [40, 10],
      [70, 60],
    ]);
    const up = ev("mouseup", 1, 0, 160, 140);
    expect(pan.release(up)).toBe(true);
    expect(up.prevented).toBe(true);
    expect(log.ends).toEqual([{ x: 70, y: 60 }]);
    expect(log.panning).toEqual([true, false]);
    expect(pan.active).toBe(false);
    // MapCanvas applies `pan` on the release: the camera is `moved` (FR-MAP-44).
    expect(cameraOn("fitted", "pan").mode).toBe("moved");
    const aux = ev("auxclick", 1, 0);
    pan.auxclick(aux);
    expect(aux.prevented).toBe(true);
  });

  test("FR-MAP-12 middle pan: a click without movement leaves the camera alone", () => {
    const { pan, log } = host();
    pan.press(ev("mousedown", 1, MIDDLE, 5, 5), state(null));
    pan.move({ clientX: 5, clientY: 5 });
    pan.release(ev("mouseup", 1, 0, 5, 5));
    expect(log.moves).toEqual([]);
    expect(log.ends).toEqual([null]);
  });

  test("FR-MAP-12 middle pan: a left press while it pans is swallowed too", () => {
    const { pan } = host();
    pan.press(ev("mousedown", 1, MIDDLE), state(fogTool));
    const left = ev("mousedown", 0, MIDDLE | LEFT);
    expect(pan.press(left, state(fogTool))).toBe("ignore");
    expect(left.stopped).toBe(true);
  });

  test("FR-MAP-12 middle pan: ignored during a left drag (OQ-MAP-45); its release never ends the drag", () => {
    const { pan, log } = host();
    // A token drag / box / brush stroke runs: the left button is down.
    const down = ev("mousedown", 1, LEFT | MIDDLE);
    expect(pan.press(down, state(null))).toBe("ignore");
    expect(down).toMatchObject({ stopped: true, prevented: true });
    expect(pan.active).toBe(false);
    pan.move({ clientX: 50, clientY: 50 });
    expect(log.moves).toEqual([]);
    // The middle release with the left still down: taken, so Konva's drag-end never sees it.
    const up = ev("mouseup", 1, LEFT);
    expect(pan.release(up)).toBe(true);
    expect(log.ends).toEqual([]);
    // A plain middle release elsewhere on the page is left alone.
    expect(pan.release(ev("mouseup", 1, 0))).toBe(false);
    expect(pan.release(ev("mouseup", 0, 0))).toBe(false);
  });

  test("FR-MAP-12 middle pan: a polygon draft keeps its vertices and closes after the pan", () => {
    const { pan } = host();
    const at = (i: number, j: number) =>
      ({
        x: i * 70,
        y: j * 70,
        cell: { col: i, row: j },
        vertex: { x: i, y: j },
        screen: { x: i * 70, y: j * 70 },
        button: 0,
        ctrl: false,
        shift: false,
        alt: false,
        clicks: 1,
        client: "dm",
        scene: { id: "scene-1" } as SceneView,
        grid: { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 },
        intent: () => new Promise(() => {}),
        signal: () => {},
      }) satisfies ToolPointer;
    /** MapCanvas's press routing: only `tool` presses reach the tool. */
    const press = (e: PanPointerEvent, p: ToolPointer) => {
      if (pan.press(e, state(fogTool)) === "tool") fogTool.pointer?.down?.(p);
    };
    setFogMode({ shape: "polygon" });
    for (const [i, j] of [
      [2, 2],
      [6, 2],
    ] as const) {
      press(ev("mousedown", 0, LEFT), at(i, j));
      fogTool.pointer?.up?.(at(i, j));
    }
    const vertices = () => {
      const d = useFogTool.getState().gesture.draft;
      return d?.kind === "polygon" ? d.points.length : 0;
    };
    expect(vertices()).toBe(2);
    press(ev("mousedown", 1, MIDDLE, 300, 300), at(9, 9));
    pan.move({ clientX: 340, clientY: 320 });
    pan.release(ev("mouseup", 1, 0, 340, 320));
    expect(vertices()).toBe(2);
    press(ev("mousedown", 0, LEFT), at(6, 6));
    fogTool.pointer?.up?.(at(6, 6));
    expect(vertices()).toBe(3);
  });

  test("FR-MAP-12 middle pan: blur ends it where it is", () => {
    const { pan, log } = host();
    pan.press(ev("mousedown", 1, MIDDLE), state(null));
    pan.move({ clientX: 3, clientY: 4 });
    pan.cancel();
    expect(log.ends).toEqual([{ x: 13, y: 24 }]);
    expect(pan.active).toBe(false);
  });
});
