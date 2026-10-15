// FR-SCN-08 Structure tool (pointer dispatch, DOM-free), FR-SCN-09 door toggles / menu,
// FR-SCN-12 reject watch, FR-SCN-13 DM drag hint, FR-SCN-06 registry entry.
import { afterEach, describe, expect, test } from "bun:test";
import { SCN_INTENTS as S, type SceneStructureRecord } from "@shared/scene-tools/schemas";
import type { SceneView } from "@shared/scenes-map/schemas";
import { canvasTools } from "../scenes-map/canvas-tools";
import type { ToolPointer } from "../scenes-map/tools";
import { activeTool, toolsFor } from "../scenes-map/tools";
import { ERASE_TOLERANCE_PX, structurePointer } from "./structure-pointer";
import {
  resetStructureGesture,
  setStructureMode,
  shownStructure,
  structureTool,
} from "./structure-store";
import {
  addPoint,
  doorMenuItems,
  dragHint,
  FLASH_MS,
  hitSegment,
  polylineSegments,
  REJECT_WATCH_MS,
  segmentsInBox,
  structureView,
  toggledDoor,
  watchDrop,
} from "./structure-view";
import { scnUndo } from "./undo-store";

const GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const AMBUSH: SceneStructureRecord = {
  id: "s1",
  campaignId: "c",
  rev: 3,
  nextN: 6,
  walls: [
    [1, 8, 0, 8, 5],
    [2, 8, 6, 8, 11],
    [3, 8, 12, 8, 14],
  ],
  doors: [
    [4, 8, 5, 8, 6, 1, 0],
    [5, 8, 11, 8, 12, 2, 0],
  ],
};

afterEach(() => {
  setStructureMode("wall");
  scnUndo.setState({ stacks: {}, busy: false });
});

function harness(record = AMBUSH, loaded = true) {
  const sent: [string, unknown][] = [];
  const rejects: unknown[] = [];
  shownStructure.setState({ sceneId: "s1", view: structureView(record), scale: 1, loaded });
  const acks: Record<string, unknown> = {
    [S.addWalls]: { ns: [6, 7] },
    [S.addDoor]: { n: 6 },
    [S.removeSegments]: null,
  };
  const at = (vx: number, vy: number, o: Partial<ToolPointer> = {}): ToolPointer => ({
    x: vx * 70,
    y: vy * 70,
    cell: { col: vx, row: vy },
    vertex: { x: vx, y: vy },
    screen: { x: 0, y: 0 },
    button: 0,
    ctrl: false,
    shift: false,
    alt: false,
    clicks: 1,
    client: "dm",
    scene: { id: "s1" } as SceneView,
    grid: GRID,
    intent: async (name, input) => {
      sent.push([name, input]);
      return acks[name];
    },
    signal: () => {},
    ...o,
  });
  return { p: structurePointer((e) => rejects.push(e)), at, sent, rejects };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("FR-SCN-08 Structure tool", () => {
  test("FR-SCN-08 Wall: clicks add snapped vertices; a double-click ends with one scn.addWalls", async () => {
    const h = harness();
    h.p.down?.(h.at(1, 1));
    h.p.down?.(h.at(3, 1));
    h.p.move?.(h.at(3, 4));
    expect(structureTool.getState()).toMatchObject({
      points: [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
      ],
      hover: { x: 3, y: 4 },
    });
    h.p.down?.(h.at(3, 4));
    h.p.down?.(h.at(3, 4, { clicks: 2 }));
    await flush();
    expect(h.sent).toEqual([
      [
        S.addWalls,
        {
          sceneId: "s1",
          segments: [
            [1, 1, 3, 1],
            [3, 1, 3, 4],
          ],
        },
      ],
    ]);
    expect(structureTool.getState().points).toEqual([]);
    // Undo records the new ns (≥ nextN 6).
    expect(scnUndo.getState().stacks.s1?.[0]?.steps[0]?.input).toEqual({
      sceneId: "s1",
      ns: [6, 7],
    });
  });

  test("FR-SCN-08 Wall: Esc / tool switch drops the polyline (cancel → true once); a lone double-click sends nothing", async () => {
    const h = harness();
    h.p.down?.(h.at(1, 1));
    expect(h.p.cancel?.("escape")).toBe(true);
    expect(h.p.cancel?.("escape")).toBe(false);
    h.p.down?.(h.at(2, 2));
    h.p.down?.(h.at(2, 2, { clicks: 2 }));
    await flush();
    expect(h.sent).toEqual([]);
  });

  test("FR-SCN-08 Door: two clicks → scn.addDoor (closed); the same vertex twice is ignored", async () => {
    const h = harness();
    setStructureMode("door");
    h.p.down?.(h.at(10, 2));
    h.p.down?.(h.at(10, 2));
    h.p.down?.(h.at(10, 3));
    await flush();
    expect(h.sent).toEqual([[S.addDoor, { sceneId: "s1", segment: [10, 2, 10, 3], state: 1 }]]);
  });

  test("FR-SCN-08 Erase: a click within 8 screen px of a segment; a Ctrl-drag box takes segments fully inside", async () => {
    const h = harness();
    setStructureMode("erase");
    h.p.down?.(h.at(0, 0, { x: 8 * 70 + 20, y: 2 * 70 })); // 20 px off the wall: miss
    h.p.down?.(h.at(0, 0, { x: 8 * 70 + 7, y: 2 * 70 }));
    h.p.move?.(h.at(0, 0, { x: 8 * 70 + 3, y: 5.5 * 70 }));
    expect(structureTool.getState().hoverN).toBe(4);
    h.p.down?.(h.at(0, 0, { x: 7 * 70, y: 4.5 * 70, ctrl: true }));
    h.p.move?.(h.at(0, 0, { x: 9 * 70, y: 12.5 * 70 }));
    expect(structureTool.getState().box).toEqual({ x0: 490, y0: 315, x1: 630, y1: 875 });
    h.p.up?.(h.at(0, 0, { x: 9 * 70, y: 12.5 * 70 }));
    await flush();
    expect(h.sent).toEqual([
      [S.removeSegments, { sceneId: "s1", ns: [1] }],
      [S.removeSegments, { sceneId: "s1", ns: [2, 4, 5] }],
    ]);
    expect(structureTool.getState().box).toBeNull();
  });

  test("FR-SCN-32 nothing is sent until the shown scene's rows are loaded, or for another scene", async () => {
    const h = harness(AMBUSH, false);
    h.p.down?.(h.at(1, 1));
    h.p.down?.(h.at(2, 1, { clicks: 2 }));
    shownStructure.setState({ loaded: true, sceneId: "other" });
    h.p.down?.(h.at(1, 1));
    await flush();
    expect(h.sent).toEqual([]);
    expect(resetStructureGesture()).toBe(false);
  });

  test("FR-SCN-06 the Structure tool is a DM drawing tool in canvas-tools", () => {
    expect(toolsFor(canvasTools, "dm").map((t) => t.id)).toContain("structure");
    expect(toolsFor(canvasTools, "player").map((t) => t.id)).not.toContain("structure");
    expect(activeTool(canvasTools, "structure", "dm")?.pointer).toBeDefined();
    expect(activeTool(canvasTools, "structure", "player")).toBeNull();
  });
});

describe("FR-SCN-08 geometry helpers", () => {
  test("FR-SCN-08 polyline: repeats ignored, identical segments dropped, ≤ 200", () => {
    let pts = addPoint([], { x: 0, y: 0 });
    pts = addPoint(pts, { x: 0, y: 0 });
    pts = addPoint(pts, { x: 1, y: 0 });
    pts = addPoint(pts, { x: 0, y: 0 });
    expect(pts).toHaveLength(3);
    expect(polylineSegments(pts)).toEqual([[0, 0, 1, 0]]);
    const long = Array.from({ length: 250 }, (_, i) => ({ x: i, y: i % 2 }));
    expect(polylineSegments(long)).toHaveLength(200);
  });

  test("FR-SCN-08 hit and box tests in map px", () => {
    const v = structureView(AMBUSH);
    expect(hitSegment(v, GRID, { x: 560 + ERASE_TOLERANCE_PX, y: 100 }, ERASE_TOLERANCE_PX)).toBe(
      1,
    );
    expect(hitSegment(v, GRID, { x: 560 + 9, y: 100 }, ERASE_TOLERANCE_PX)).toBeNull();
    // Zoomed out ×0.5: 8 screen px = 16 map px.
    expect(hitSegment(v, GRID, { x: 560 + 12, y: 100 }, ERASE_TOLERANCE_PX / 0.5)).toBe(1);
    expect(segmentsInBox(v, GRID, { x0: 600, y0: 0, x1: 500, y1: 430 })).toEqual([1, 4]);
  });
});

describe("FR-SCN-09 doors", () => {
  test("FR-SCN-09 double-click toggles open ↔ closed; a locked door stays locked", () => {
    expect(toggledDoor(0)).toBe(1);
    expect(toggledDoor(1)).toBe(0);
    expect(toggledDoor(2)).toBeNull();
  });

  test("FR-SCN-09 menu items per state", () => {
    const items = (s: 0 | 1 | 2) => doorMenuItems(s).map((i) => `${i.item}:${i.state}`);
    expect(items(0)).toEqual(["close:1", "lock:2", "delete:null"]);
    expect(items(1)).toEqual(["open:0", "lock:2", "delete:null"]);
    expect(items(2)).toEqual(["open:0", "unlock:1", "delete:null"]);
  });
});

describe("FR-SCN-13 DM drag hint", () => {
  test("FR-SCN-13 Goblin (12, 6) → (4, 6) crosses wall 2; through the open door nothing; players get none", () => {
    const v = structureView(AMBUSH);
    expect(dragHint(v, { from: { col: 12, row: 6 }, to: { col: 4, row: 6 }, size: 1 })).toEqual({
      ns: [2],
      to: { col: 4, row: 6 },
      size: 1,
    });
    const opened = structureView({ ...AMBUSH, doors: [[4, 8, 5, 8, 6, 0, 0]] });
    expect(
      dragHint(opened, { from: { col: 9, row: 5 }, to: { col: 7, row: 5 }, size: 1 }),
    ).toBeNull();
    expect(
      dragHint(structureView({ id: "s1", doors: [] }), {
        from: { col: 12, row: 6 },
        to: { col: 4, row: 6 },
        size: 1,
      }),
    ).toBeNull();
    expect(dragHint(v, null)).toBeNull();
  });
});

describe("FR-SCN-12 blocked-move cue", () => {
  const w = { tokenId: "m", to: { col: 10, row: 7 }, size: 1, at: 0, seen: false };
  const from = { col: 2, row: 7 };
  test("FR-SCN-12 shown at the target, then snapped back while the record stayed → flash", () => {
    const a = watchDrop(w, w.to, from, 10);
    expect(a).toEqual({ watch: { ...w, seen: true }, flash: false });
    expect(watchDrop(a.watch, from, from, 50)).toEqual({ watch: null, flash: true });
    expect(FLASH_MS).toBe(1000);
  });
  test("FR-SCN-12 an ack (record at the target), an unsent drop or a timeout → no flash", () => {
    expect(watchDrop({ ...w, seen: true }, w.to, w.to, 20).flash).toBe(false);
    expect(watchDrop({ ...w, seen: true }, w.to, w.to, 20).watch).toBeNull();
    expect(watchDrop(w, from, from, 20)).toEqual({ watch: w, flash: false });
    expect(watchDrop({ ...w, seen: true }, from, from, REJECT_WATCH_MS + 1).flash).toBe(false);
    expect(watchDrop(null, from, from, 0)).toEqual({ watch: null, flash: false });
  });
});
