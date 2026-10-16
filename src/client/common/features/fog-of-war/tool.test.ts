// FOG §13 client unit rows: FR-FOG-17 tool line + dispatch rules (Space pans, tokens take no
// left-press, right-click menus kept), the pointer handlers sending `fog.edit` per mode
// (FR-FOG-18/19/41), darkness place / move / remove + its menu (FR-FOG-42), the draft until the
// event or reject, and FR-FOG-22 drops.
import { afterEach, describe, expect, test } from "bun:test";
import { FOG_INTENTS, type FogEditKind, type FogRecord } from "@shared/fog-of-war/schemas";
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
import {
  applyFogStep,
  fogPointer,
  removeDarkness,
  setFogMode,
  setFogReader,
  setFogRejectHandler,
  useFogTool,
} from "./store";
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
  /** A pointer at grid point (x, y) (70 px cells, no offset); screen px given. */
  const at = (x: number, y: number, sx: number, sy: number, o: Partial<ToolPointer> = {}) =>
    ({
      x: x * 70,
      y: y * 70,
      cell: { col: Math.floor(x), row: Math.floor(y) },
      vertex: { x: Math.round(x), y: Math.round(y) },
      screen: { x: sx, y: sy },
      button: 0,
      ctrl: false,
      shift: false,
      alt: false,
      clicks: 1,
      client,
      scene: { id: "scene-1" } as SceneView,
      grid: { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 },
      intent,
      signal: () => {},
      ...o,
    }) satisfies ToolPointer;
  return { sent, at };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  useFogTool.setState({
    mode: "reveal",
    shape: "rect",
    gesture: idleGesture,
    hint: null,
    menu: null,
  });
  setFogReader(() => undefined);
});

const fogWith = (r: Partial<FogRecord>) =>
  ({ id: "scene-1", shapes: [], darkness: [], undo: null, ...r }) as FogRecord;
const undoOf = (kind: FogEditKind) => ({ n: 1, editId: "e", kind });

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
    // Right-click (token menu, laser, the darkness menu's own handler) never reaches `down`.
    expect(pressGoesToTool(fogTool, { button: 2, space: false, live: true })).toBe(false);
    expect(pressGoesToTool(fogTool, { button: 0, space: false, live: false })).toBe(false);
  });

  test("FR-FOG-17 defaults Reveal, Rectangle; Undo tooltip names the step", () => {
    expect(useFogTool.getState()).toMatchObject({ mode: "reveal", shape: "rect" });
    expect(undoHint(undefined)).toBe("Nothing to undo");
    expect(undoHint(fogWith({ undo: undoOf("reveal-polygon") }))).toBe("Undo: reveal polygon");
    expect(undoHint(fogWith({ undo: undoOf("hide-rect") }))).toBe("Undo: fog rectangle");
    expect(undoHint(fogWith({ undo: undoOf("fog-all") }))).toBe("Undo: fog all");
    expect(
      undoHint(
        fogWith({
          undo: undoOf("explored-shape"),
          shapes: [{ op: "explored", circle: [1, 1, 1] }],
        }),
      ),
    ).toBe("Undo: explored circle");
    expect(
      undoHint(
        fogWith({
          undo: undoOf("fog-shape"),
          shapes: [{ op: "fog", polygon: [0, 0, 1, 0, 1, 1] }],
        }),
      ),
    ).toBe("Undo: fog polygon");
    expect(undoHint(fogWith({ undo: undoOf("darkness-move") }))).toBe("Undo: darkness move");
  });
});

describe("FR-FOG-18/19/41 sending", () => {
  test("FR-FOG-18 rect drag → one fog.edit (snapped corners) on the shown scene; the draft stays until the ack", async () => {
    const { sent, at } = harness();
    fogPointer.down?.(at(11.2, 5.3, 100, 100));
    fogPointer.move?.(at(13.6, 7.7, 240, 240));
    fogPointer.up?.(at(13.6, 7.7, 240, 240));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe(FOG_INTENTS.edit);
    expect(sent[0]?.input).toEqual({
      sceneId: "scene-1",
      op: "reveal",
      shape: { rect: [11, 5, 14, 8] },
    });
    expect(useFogTool.getState().gesture).toMatchObject({ pending: true, draft: { kind: "rect" } });
    sent[0]?.resolve({ editId: "e1" });
    await tick();
    expect(useFogTool.getState().gesture).toMatchObject({ pending: false, draft: null });
  });

  test("FR-FOG-17 Fog / Explored modes send their op; Ctrl gives free coordinates; a reject removes the draft and toasts", async () => {
    const { sent, at } = harness();
    const rejected: unknown[] = [];
    setFogRejectHandler((e) => rejected.push(e));
    setFogMode({ mode: "fog" });
    fogPointer.down?.(at(2.4, 2.4, 10, 10));
    fogPointer.up?.(at(2.4, 2.4, 11, 10));
    expect(sent[0]?.input).toMatchObject({ op: "fog", shape: { rect: [2, 2, 3, 3] } });
    sent[0]?.reject(new Error("Fog too detailed — use Fog all or Reveal all to start over"));
    await tick();
    expect(useFogTool.getState().gesture.draft).toBeNull();
    expect(rejected).toHaveLength(1);
    setFogMode({ mode: "explored", shape: "circle" });
    fogPointer.down?.(at(16.4, 3.7, 10, 10, { ctrl: true }));
    fogPointer.move?.(at(18.6, 3.7, 160, 10, { ctrl: true }));
    expect(useFogTool.getState().gesture.free).toBe(true);
    fogPointer.up?.(at(18.6, 3.7, 160, 10, { ctrl: true }));
    expect(sent[1]?.input).toEqual({
      sceneId: "scene-1",
      op: "explored",
      shape: { circle: [16.4, 3.7, 2.2] },
    });
  });

  test("FR-FOG-19 polygon clicks, then Enter → one fog.edit with the vertices", () => {
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
      shape: { polygon: [15, 10, 19, 10, 19, 13, 15, 13] },
    });
  });

  test("FR-FOG-19 a refused vertex shows the hint at the click", () => {
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

describe("FR-FOG-42 darkness", () => {
  const darkness = [{ id: "d1", circle: [12.5, 9, 1.5] as [number, number, number] }];

  test("FR-FOG-30 Darkness mode: a drawn circle → fog.placeDarkness", () => {
    const { sent, at } = harness();
    setFogReader(() => fogWith({ darkness }));
    setFogMode({ mode: "darkness", shape: "circle" });
    fogPointer.down?.(at(4.1, 4.2, 10, 10));
    fogPointer.move?.(at(7.1, 4.2, 220, 10));
    fogPointer.up?.(at(7.1, 4.2, 220, 10));
    expect(sent[0]).toMatchObject({
      name: FOG_INTENTS.placeDarkness,
      input: { sceneId: "scene-1", shape: { circle: [4, 4, 3] } },
    });
  });

  test("FR-FOG-42 drag a darkness shape → fog.moveDarkness (whole cells); Delete → fog.removeDarkness", async () => {
    const { sent, at } = harness();
    setFogReader(() => fogWith({ darkness }));
    setFogMode({ mode: "darkness" });
    fogPointer.down?.(at(12.5, 9, 100, 100));
    fogPointer.move?.(at(14.7, 8.2, 260, 40));
    fogPointer.up?.(at(14.7, 8.2, 260, 40));
    expect(sent[0]).toMatchObject({
      name: FOG_INTENTS.moveDarkness,
      input: { sceneId: "scene-1", darknessId: "d1", dx: 2, dy: -1 },
    });
    expect(useFogTool.getState().gesture.move).toMatchObject({ pending: true, dx: 2 });
    sent[0]?.resolve({ editId: "e" });
    await tick();
    expect(useFogTool.getState().gesture).toMatchObject({ move: null, selected: "d1" });
    const step = gestureKey(useFogTool.getState().gesture, "Delete");
    if (step) applyFogStep(step, null);
    expect(sent[1]).toMatchObject({
      name: FOG_INTENTS.removeDarkness,
      input: { sceneId: "scene-1", darknessId: "d1" },
    });
  });

  test("FR-FOG-42 right press on a darkness shape opens its menu (Remove); elsewhere or in another mode the laser keeps it", () => {
    const { sent, at } = harness();
    setFogReader(() => fogWith({ darkness }));
    expect(fogPointer.menu?.(at(12.5, 9, 300, 200, { button: 2 }))).toBe(false); // Reveal mode
    setFogMode({ mode: "darkness" });
    expect(fogPointer.menu?.(at(2, 2, 30, 20, { button: 2 }))).toBe(false); // empty space
    expect(fogPointer.menu?.(at(12.5, 9, 300, 200, { button: 2 }))).toBe(true);
    expect(useFogTool.getState()).toMatchObject({
      menu: { id: "d1", at: { x: 300, y: 200 } },
      gesture: { selected: "d1" },
    });
    removeDarkness("d1");
    expect(sent[0]).toMatchObject({
      name: FOG_INTENTS.removeDarkness,
      input: { darknessId: "d1" },
    });
    expect(useFogTool.getState().menu).toBeNull();
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
