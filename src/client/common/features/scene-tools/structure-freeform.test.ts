// FR-SCN-08 (sprint 3, #202, #207 OQ-SCN-24) freeform structure drawing: Ctrl = a free point per
// click (0.01 cell), mixed polylines, the 8 px endpoint magnet in both modes, a door into a gap,
// the "Free" chip, Erase unchanged; BL-12 (Erase on a door over a wall takes the door).
import { afterEach, describe, expect, test } from "bun:test";
import { SCN_INTENTS as S, type SceneStructureRecord } from "@shared/scene-tools/schemas";
import type { SceneView } from "@shared/scenes-map/schemas";
import type { ToolPointer } from "../scenes-map/tools";
import { structureCtrl, structurePointer } from "./structure-pointer";
import { setStructureMode, shownStructure, structureTool } from "./structure-store";
import { freeChipShown } from "./structure-tool";
import {
  addPoint,
  freePoint,
  hitSegment,
  isFreePoint,
  MAGNET_PX,
  magnetPoint,
  pickPoint,
  structureView,
} from "./structure-view";
import { scnUndo } from "./undo-store";

const CS = 70;
const GRID = { gridCellSize: CS, gridOffsetX: 0, gridOffsetY: 0 };
/** Goblin Ambush's x = 8 walls and doors, plus the S1 walls (10, 2)–(12.4, 3.65), (13.1, 4.8)–(15, 6). */
const REC: SceneStructureRecord = {
  id: "s1",
  campaignId: "c",
  rev: 3,
  nextN: 8,
  walls: [
    [1, 8, 0, 8, 5],
    [2, 8, 6, 8, 11],
    [3, 8, 12, 8, 14],
    [6, 10, 2, 12.4, 3.65],
    [7, 13.1, 4.8, 15, 6],
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

function harness(scale = 1) {
  const sent: [string, unknown][] = [];
  shownStructure.setState({ sceneId: "s1", view: structureView(REC), scale, loaded: true });
  /** A pointer at grid point `(gx, gy)` (any decimals), as MapCanvas builds it. */
  const at = (gx: number, gy: number, o: Partial<ToolPointer> = {}): ToolPointer => ({
    x: gx * CS,
    y: gy * CS,
    cell: { col: Math.floor(gx), row: Math.floor(gy) },
    vertex: { x: Math.round(gx), y: Math.round(gy) },
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
      return name === S.addDoor ? { n: 8 } : { ns: [8, 9] };
    },
    signal: () => {},
    ...o,
  });
  return { p: structurePointer(() => {}), at, sent };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("FR-SCN-08 freeform gestures", () => {
  test("FR-SCN-08 Ctrl per click: a free point (0.01 cell); without Ctrl the nearest vertex; one polyline mixes both", async () => {
    const h = harness();
    h.p.down?.(h.at(4.2, 9.1)); // no Ctrl → vertex (4, 9)
    h.p.down?.(h.at(5.437, 10.333, { ctrl: true })); // Ctrl → (5.44, 10.33)
    h.p.down?.(h.at(6.9, 9.2)); // vertex (7, 9)
    h.p.down?.(h.at(6.9, 9.2, { clicks: 2 }));
    await flush();
    expect(h.sent).toEqual([
      [
        S.addWalls,
        {
          sceneId: "s1",
          segments: [
            [4, 9, 5.44, 10.33],
            [5.44, 10.33, 7, 9],
          ],
        },
      ],
    ]);
  });

  test("FR-SCN-08 the hover follows Ctrl: free while held (also on a key press without a move), the vertex after", () => {
    const h = harness();
    h.p.move?.(h.at(3.3, 2.71));
    expect(structureTool.getState().hover).toEqual({ x: 3, y: 3 });
    structureCtrl(true);
    expect(structureTool.getState().hover).toEqual({ x: 3.3, y: 2.71 });
    h.p.move?.(h.at(3.31, 2.71, { ctrl: true }));
    expect(structureTool.getState().hover).toEqual({ x: 3.31, y: 2.71 });
    structureCtrl(false);
    expect(structureTool.getState().hover).toEqual({ x: 3, y: 3 });
    expect(isFreePoint({ x: 3.31, y: 2.71 })).toBe(true);
    expect(isFreePoint({ x: 3, y: 3 })).toBe(false);
  });

  test("FR-SCN-08 magnet: within 8 screen px of an endpoint snaps to it (Ctrl or not); outside it does not", () => {
    const v = structureView(REC);
    const tol = MAGNET_PX;
    const near = { x: 12.4 * CS + 5, y: 3.65 * CS, ctrl: true }; // 5 px from (12.4, 3.65)
    expect(pickPoint(v, [], GRID, near, tol)).toEqual({ x: 12.4, y: 3.65 });
    expect(pickPoint(v, [], GRID, { ...near, ctrl: false }, tol)).toEqual({ x: 12.4, y: 3.65 });
    const far = { x: 12.4 * CS + 9, y: 3.65 * CS, ctrl: true }; // 9 px: free point
    expect(pickPoint(v, [], GRID, far, tol)).toEqual(freePoint(GRID, far.x, far.y));
    expect(pickPoint(v, [], GRID, { ...far, ctrl: false }, tol)).toEqual({ x: 13, y: 4 });
    // Zoomed out ×0.5: 8 screen px = 16 map px.
    expect(magnetPoint(v, [], GRID, far, tol / 0.5)).toEqual({ x: 12.4, y: 3.65 });
    // The polyline in progress is a magnet too (a double-click lands on the last free point).
    expect(magnetPoint(v, [{ x: 2.33, y: 1.5 }], GRID, { x: 2.33 * CS + 3, y: 105 }, tol)).toEqual({
      x: 2.33,
      y: 1.5,
    });
    // Nothing near: null.
    expect(magnetPoint(v, [], GRID, { x: 1, y: 1 }, tol)).toBeNull();
  });

  test("FR-SCN-08 S2: a door 5 px from each free wall end lands exactly on both ends (closes the gap)", async () => {
    const h = harness();
    setStructureMode("door");
    h.p.down?.(h.at(12.4 + 5 / CS, 3.65));
    h.p.down?.(h.at(13.1, 4.8 - 5 / CS));
    await flush();
    expect(h.sent).toEqual([
      [S.addDoor, { sceneId: "s1", segment: [12.4, 3.65, 13.1, 4.8], state: 1 }],
    ]);
  });

  test("FR-SCN-08 Door with Ctrl: free ends; points < 0.05 cell apart are one point", async () => {
    const h = harness();
    setStructureMode("door");
    h.p.down?.(h.at(2.5, 2.5, { ctrl: true }));
    h.p.down?.(h.at(2.53, 2.5, { ctrl: true })); // 0.03 cell: ignored
    h.p.down?.(h.at(3.25, 2.5, { ctrl: true }));
    await flush();
    expect(h.sent).toEqual([
      [S.addDoor, { sceneId: "s1", segment: [2.5, 2.5, 3.25, 2.5], state: 1 }],
    ]);
    expect(addPoint([{ x: 1, y: 1 }], { x: 1.04, y: 1 })).toEqual([{ x: 1, y: 1 }]);
    expect(addPoint([{ x: 1, y: 1 }], { x: 1.05, y: 1 })).toHaveLength(2);
  });

  test("FR-SCN-08 Erase unchanged: Ctrl-drag still box-selects, no magnet or free point", async () => {
    const h = harness();
    setStructureMode("erase");
    h.p.move?.(h.at(12.4 + 5 / CS, 3.65, { ctrl: true }));
    expect(structureTool.getState().hover).toEqual({ x: 12, y: 4 });
    h.p.down?.(h.at(9.5, 1.5, { ctrl: true }));
    h.p.move?.(h.at(15.5, 6.5, { ctrl: true }));
    h.p.up?.(h.at(15.5, 6.5, { ctrl: true }));
    await flush();
    expect(h.sent).toEqual([[S.removeSegments, { sceneId: "s1", ns: [6, 7] }]]);
  });

  test('FR-SCN-08 "Free" chip: Wall / Door mode, Ctrl held, over the canvas', () => {
    expect(freeChipShown("wall", true, true)).toBe(true);
    expect(freeChipShown("door", true, true)).toBe(true);
    expect(freeChipShown("erase", true, true)).toBe(false);
    expect(freeChipShown("wall", false, true)).toBe(false);
    expect(freeChipShown("wall", true, false)).toBe(false);
  });
});

describe("BL-12 Erase on a door over a wall", () => {
  test("BL-12 a door drawn on a wall's line: the click erases the door, then the wall", () => {
    const v = structureView({
      ...REC,
      walls: [[1, 2, 2, 6, 2]],
      doors: [[2, 3, 2, 4, 2, 1, 0]],
    });
    expect(hitSegment(v, GRID, { x: 3.5 * CS, y: 2 * CS + 2 }, 8)).toBe(2);
    expect(
      hitSegment(
        structureView({ ...REC, walls: [[1, 2, 2, 6, 2]], doors: [] }),
        GRID,
        { x: 3.5 * CS, y: 2 * CS + 2 },
        8,
      ),
    ).toBe(1);
  });
});
