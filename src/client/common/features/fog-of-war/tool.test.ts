// FOG §13 client unit rows: FR-FOG-17 tool line + dispatch rules (Space pans, tokens take no
// left-press, right-click menus kept), the pointer handlers sending `fog.edit` (FR-FOG-18/19), the
// draft until the event or reject, and FR-FOG-22 drops.
import { afterEach, describe, expect, test } from "bun:test";
import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import type { SceneView } from "@shared/scenes-map/schemas";
import { canvasTools } from "../scenes-map/canvas-tools";
import {
  activeTool,
  pressGoesToTool,
  stagePans,
  type ToolPointer,
  tokenTakesLeftPress,
  toolsFor,
} from "../scenes-map/tools";
import { undoHint } from "./FogBar";
import { gestureKey, idleGesture } from "./gesture";
import { applyFogStep, fogPointer, setFogMode, setFogRejectHandler, useFogTool } from "./store";
import { fogTool } from "./tool";

interface Sent {
  name: string;
  input: unknown;
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

function harness(client: "dm" | "player" = "dm") {
  const sent: Sent[] = [];
  const intent = (name: string, input: unknown) =>
    new Promise<unknown>((resolve, reject) => sent.push({ name, input, resolve, reject }));
  const at = (col: number, row: number, x: number, y: number, clicks = 1): ToolPointer => ({
    x: col * 70,
    y: row * 70,
    cell: { col, row },
    vertex: { x: col, y: row },
    screen: { x, y },
    button: 0,
    ctrl: false,
    shift: false,
    alt: false,
    clicks,
    client,
    scene: { id: "scene-1" } as SceneView,
    grid: { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 },
    intent,
    signal: () => {},
  });
  return { sent, at };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  useFogTool.setState({ op: "reveal", shape: "rect", gesture: idleGesture, hint: null });
});

describe("FR-FOG-17 Fog tool", () => {
  test("FR-FOG-17 a DM line in canvas-tools: icon, panel, pointer; players don't get it", () => {
    expect(canvasTools).toContain(fogTool);
    expect(fogTool).toMatchObject({ id: "fog", label: "Fog", clients: ["dm"] });
    expect(fogTool.panel).toBeDefined();
    expect(toolsFor(canvasTools, "player")).not.toContain(fogTool);
    expect(activeTool(canvasTools, "fog", "dm")).toBe(fogTool);
    expect(activeTool(canvasTools, "fog", "player")).toBeNull();
  });

  test("FR-FOG-17 while active: tokens take no left-press; Space + drag pans; right-click and not-live presses skip the tool", () => {
    expect(tokenTakesLeftPress(fogTool)).toBe(false);
    expect(pressGoesToTool(fogTool, { button: 0, space: false, live: true })).toBe(true);
    expect(pressGoesToTool(fogTool, { button: 0, space: true, live: true })).toBe(false);
    expect(stagePans("fog", true)).toBe(true);
    expect(stagePans("fog", false)).toBe(false);
    // Right-click (token menu, laser) never reaches the tool.
    expect(pressGoesToTool(fogTool, { button: 2, space: false, live: true })).toBe(false);
    expect(pressGoesToTool(fogTool, { button: 0, space: false, live: false })).toBe(false);
  });

  test("FR-FOG-17 defaults Reveal, Rectangle; Undo tooltip names the step", () => {
    expect(useFogTool.getState()).toMatchObject({ op: "reveal", shape: "rect" });
    expect(undoHint(null)).toBe("Nothing to undo");
    expect(undoHint({ n: 4, editId: "e", kind: "reveal-polygon" })).toBe("Undo: reveal polygon");
    expect(undoHint({ n: 1, editId: "e", kind: "hide-rect" })).toBe("Undo: hide rectangle");
    expect(undoHint({ n: 1, editId: "e", kind: "reveal-all" })).toBe("Undo: reveal all");
  });
});

describe("FR-FOG-18/19 sending", () => {
  test("FR-FOG-18 rect drag → one fog.edit on the shown scene; the draft stays until the ack", async () => {
    const { sent, at } = harness();
    fogPointer.down?.(at(11, 5, 100, 100));
    fogPointer.move?.(at(13, 7, 240, 240));
    fogPointer.up?.(at(13, 7, 240, 240));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe(FOG_INTENTS.edit);
    expect(sent[0]?.input).toEqual({
      sceneId: "scene-1",
      op: "reveal",
      shape: { kind: "rect", c0: 11, r0: 5, c1: 13, r1: 7 },
    });
    expect(useFogTool.getState().gesture).toMatchObject({ pending: true, draft: { kind: "rect" } });
    sent[0]?.resolve({ editId: "e1" });
    await tick();
    expect(useFogTool.getState().gesture).toMatchObject({ pending: false, draft: null });
  });

  test("FR-FOG-18 Hide mode sends op hide; a reject removes the draft and toasts", async () => {
    const { sent, at } = harness();
    const rejected: unknown[] = [];
    setFogRejectHandler((e) => rejected.push(e));
    setFogMode({ op: "hide" });
    fogPointer.down?.(at(2, 2, 10, 10));
    fogPointer.up?.(at(2, 2, 11, 10));
    expect(sent[0]?.input).toMatchObject({ op: "hide", shape: { c0: 2, r0: 2, c1: 2, r1: 2 } });
    sent[0]?.reject(new Error("Fog too detailed — reveal or hide larger areas"));
    await tick();
    expect(useFogTool.getState().gesture.draft).toBeNull();
    expect(rejected).toHaveLength(1);
  });

  test("FR-FOG-19 polygon clicks, then Enter → one fog.edit with the corners", () => {
    const { sent, at } = harness();
    setFogMode({ shape: "polygon" });
    for (const [i, j] of [
      [15, 10],
      [19, 10],
      [19, 13],
      [15, 13],
    ] as const) {
      fogPointer.down?.(at(i, j, i * 70, j * 70));
      fogPointer.up?.(at(i, j, i * 70, j * 70));
    }
    expect(sent).toHaveLength(0);
    const step = gestureKey(useFogTool.getState().gesture, "Enter");
    if (step) applyFogStep(step, null);
    expect(sent[0]?.input).toEqual({
      sceneId: "scene-1",
      op: "reveal",
      shape: {
        kind: "polygon",
        points: [
          [15, 10],
          [19, 10],
          [19, 13],
          [15, 13],
        ],
      },
    });
  });

  test("FR-FOG-19 a refused corner shows the hint at the click", () => {
    const { at } = harness();
    setFogMode({ shape: "polygon" });
    for (const [i, j] of [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [6, 2],
    ] as const) {
      fogPointer.down?.(at(i, j, i * 70, j * 70));
      fogPointer.up?.(at(i, j, i * 70, j * 70));
    }
    expect(useFogTool.getState().hint).toMatchObject({
      text: "Edges can't cross",
      at: { x: 420, y: 140 },
    });
  });

  test("FR-FOG-17 a mode switch drops the shape being drawn", () => {
    const { at } = harness();
    fogPointer.down?.(at(1, 1, 0, 0));
    setFogMode({ shape: "polygon" });
    expect(useFogTool.getState().gesture).toEqual(idleGesture);
  });

  test("FR-FOG-17 the player client's events do nothing", () => {
    const { sent, at } = harness("player");
    fogPointer.down?.(at(1, 1, 0, 0));
    fogPointer.up?.(at(1, 1, 0, 0));
    expect(sent).toHaveLength(0);
    expect(useFogTool.getState().gesture).toEqual(idleGesture);
  });
});

describe("FR-FOG-22 drops", () => {
  test("FR-FOG-22 leaving live mid-drag drops it unsent; Esc returns whether a gesture was dropped", () => {
    const { sent, at } = harness();
    fogPointer.down?.(at(1, 1, 0, 0));
    expect(fogPointer.cancel?.("live")).toBe(true);
    fogPointer.up?.(at(3, 3, 200, 200));
    expect(sent).toHaveLength(0);
    expect(useFogTool.getState().gesture).toEqual(idleGesture);
    expect(fogPointer.cancel?.("escape")).toBe(false);
    for (const reason of ["scene", "tool"] as const) {
      fogPointer.down?.(at(1, 1, 0, 0));
      expect(fogPointer.cancel?.(reason)).toBe(true);
    }
  });
});
