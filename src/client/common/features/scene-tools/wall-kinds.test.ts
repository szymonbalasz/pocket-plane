// FR-SCN-61–63 in the Structure tool: Window and One-way draw like Wall with their kind and
// `replace`; undo gives back what a polyline replaced, by kind; Flip picks one-way walls only (a
// click or a Ctrl-drag box) and undoes itself; a one-way wall's arrows point the way sight passes.
import { afterEach, describe, expect, test } from "bun:test";
import { pointInPolygon, sightPolygon } from "@shared/fog-of-war/vision";
import { sightOccluders } from "@shared/scene-tools/geometry";
import {
  WALL_ONE_WAY as ONE_WAY,
  SCN_INTENTS as S,
  type SceneStructureRecord,
  WALL_WINDOW as WINDOW,
} from "@shared/scene-tools/schemas";
import type { Grid } from "@shared/scenes-map/geometry";
import type { SceneView } from "@shared/scenes-map/schemas";
import type { ToolPointer } from "../scenes-map/tools";
import { structurePointer } from "./structure-pointer";
import {
  drawsLine,
  lineKind,
  picksSegments,
  STRUCTURE_MODES,
  setStructureMode,
  shownStructure,
  structureTool,
} from "./structure-store";
import { freeChipShown } from "./structure-tool";
import { hitSegment, oneWayArrows, oneWayView, structureView, wallsByKind } from "./structure-view";
import { scnUndo } from "./undo-store";

const GRID: Grid = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const REC: SceneStructureRecord = {
  id: "s1",
  campaignId: "c1",
  rev: 1,
  nextN: 6,
  walls: [
    [1, 8, 0, 8, 5],
    [2, 9, 0, 9, 5, WINDOW],
    [3, 10, 0, 10, 5, ONE_WAY],
    [4, 11, 5, 11, 0, ONE_WAY],
  ],
  doors: [[5, 12, 0, 12, 5, 1, 0]],
};

afterEach(() => {
  setStructureMode("wall");
  scnUndo.setState({ stacks: {}, busy: false });
});

function harness(acks: Record<string, unknown> = {}) {
  const sent: [string, unknown][] = [];
  const rejects: unknown[] = [];
  shownStructure.setState({ sceneId: "s1", view: structureView(REC), scale: 1, loaded: true });
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
      return acks[name] ?? null;
    },
    signal: () => {},
    ...o,
  });
  return { p: structurePointer((e) => rejects.push(e)), at, sent, rejects };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const steps = () =>
  scnUndo
    .getState()
    .stacks.s1?.at(-1)
    ?.steps.map((s) => [s.name, s.input]);

describe("FR-SCN-61 / -62 drawing", () => {
  test("FR-SCN-61 the modes: which draw lines, with which kind; which show the Free chip", () => {
    expect(STRUCTURE_MODES.filter(drawsLine)).toEqual(["wall", "window", "one-way"]);
    expect(lineKind("wall")).toBeUndefined();
    expect(lineKind("window")).toBe(WINDOW);
    expect(lineKind("one-way")).toBe(ONE_WAY);
    expect(STRUCTURE_MODES.filter(picksSegments)).toEqual(["erase", "flip"]);
    expect(freeChipShown("window", true, true)).toBe(true);
    expect(freeChipShown("one-way", true, true)).toBe(true);
    expect(freeChipShown("flip", true, true)).toBe(false);
  });

  for (const [mode, kind] of [
    ["window", WINDOW],
    ["one-way", ONE_WAY],
  ] as const) {
    test(`FR-SCN-61 ${mode}: clicks, a double-click ends with one scn.addWalls of that kind, in drawn order`, async () => {
      const h = harness({ [S.addWalls]: { ns: [6, 7] } });
      setStructureMode(mode);
      h.p.down?.(h.at(1, 1));
      h.p.down?.(h.at(1, 3));
      h.p.down?.(h.at(3, 3, { clicks: 2 }));
      await flush();
      expect(h.sent).toEqual([
        [
          S.addWalls,
          {
            sceneId: "s1",
            segments: [
              [1, 1, 1, 3],
              [1, 3, 3, 3],
            ],
            replace: true,
            kind,
          },
        ],
      ]);
      expect(steps()).toEqual([[S.removeSegments, { sceneId: "s1", ns: [6, 7] }]]);
    });
  }

  test("FR-SCN-62 undo: what the polyline replaced comes back first, per kind and with its direction; then what it drew and the pieces go", async () => {
    const h = harness({
      [S.addWalls]: {
        ns: [6],
        replaced: [
          [1, 8, 0, 8, 5],
          [4, 11, 5, 11, 0, ONE_WAY],
        ],
        pieces: [7, 8],
      },
    });
    setStructureMode("window");
    h.p.down?.(h.at(1, 1));
    h.p.down?.(h.at(1, 3, { clicks: 2 }));
    await flush();
    expect(steps()).toEqual([
      [S.addWalls, { sceneId: "s1", segments: [[8, 0, 8, 5]] }],
      [S.addWalls, { sceneId: "s1", segments: [[11, 5, 11, 0]], kind: ONE_WAY }],
      [S.removeSegments, { sceneId: "s1", ns: [6, 7, 8] }],
    ]);
  });

  test("FR-SCN-61 erase: undo re-adds each wall with its kind and direction", async () => {
    const h = harness();
    setStructureMode("erase");
    h.p.down?.(h.at(7, 0, { shift: true }));
    h.p.up?.(h.at(11.5, 5.5));
    await flush();
    expect(h.sent).toEqual([[S.removeSegments, { sceneId: "s1", ns: [1, 2, 3, 4] }]]);
    expect(steps()).toEqual([
      [S.addWalls, { sceneId: "s1", segments: [[8, 0, 8, 5]] }],
      [S.addWalls, { sceneId: "s1", segments: [[9, 0, 9, 5]], kind: WINDOW }],
      [
        S.addWalls,
        {
          sceneId: "s1",
          segments: [
            [10, 0, 10, 5],
            [11, 5, 11, 0],
          ],
          kind: ONE_WAY,
        },
      ],
    ]);
  });
});

describe("FR-SCN-63 Flip", () => {
  test("FR-SCN-63 a click flips the one-way wall under it; undo flips it back", async () => {
    const h = harness();
    setStructureMode("flip");
    h.p.down?.(h.at(10, 2));
    await flush();
    expect(h.sent).toEqual([[S.flipWalls, { sceneId: "s1", ns: [3] }]]);
    expect(steps()).toEqual([[S.flipWalls, { sceneId: "s1", ns: [3] }]]);
  });

  test("FR-SCN-63 a click on a plain wall, a window or a door does nothing", async () => {
    const h = harness();
    setStructureMode("flip");
    for (const x of [8, 9, 12]) {
      h.p.move?.(h.at(x, 2));
      expect(structureTool.getState().hoverN).toBeNull();
      h.p.down?.(h.at(x, 2));
    }
    await flush();
    expect(h.sent).toEqual([]);
  });

  test("FR-SCN-63 hover names the wall it would flip; a Ctrl-drag box flips one-way walls only", async () => {
    const h = harness();
    setStructureMode("flip");
    h.p.move?.(h.at(11, 2));
    expect(structureTool.getState().hoverN).toBe(4);
    h.p.down?.(h.at(7, 0, { ctrl: true }));
    h.p.up?.(h.at(13, 6));
    await flush();
    expect(h.sent).toEqual([[S.flipWalls, { sceneId: "s1", ns: [3, 4] }]]);
  });

  test("FR-SCN-63 a box with no one-way wall sends nothing", async () => {
    const h = harness();
    setStructureMode("flip");
    h.p.down?.(h.at(7.5, 0, { ctrl: true }));
    h.p.up?.(h.at(9.5, 6));
    await flush();
    expect(h.sent).toEqual([]);
  });
});

describe("FR-SCN-61 drawing the kinds", () => {
  test("FR-SCN-61 wallsByKind splits them in map px", () => {
    const k = wallsByKind(REC.walls, GRID);
    expect(k.plain).toEqual([[560, 0, 560, 350]]);
    expect(k.windows).toEqual([[630, 0, 630, 350]]);
    expect(k.oneWay).toEqual([
      [700, 0, 700, 350],
      [770, 350, 770, 0],
    ]);
  });

  test("FR-SCN-61 about one arrow per cell, and they point the way sight passes", () => {
    const arrows = oneWayArrows([560, 0, 560, 700], 70);
    expect(arrows).toHaveLength(10);
    for (const [x1, , tx, , x2] of arrows) {
      expect(x1).toBe(560);
      expect(x2).toBe(560);
      expect(tx).toBeGreaterThan(560);
    }
    // The same wall in grid units: sight goes where the tips point (east), not back.
    const occ = sightOccluders({ walls: [[1, 8, 0, 8, 10, ONE_WAY]], doors: [] });
    expect(pointInPolygon(sightPolygon({ x: 5, y: 5 }, 40, occ) as number[], 11, 5)).toBe(true);
    expect(pointInPolygon(sightPolygon({ x: 11, y: 5 }, 40, occ) as number[], 5, 5)).toBe(false);
    // Reversed, they point back.
    expect(oneWayArrows([560, 700, 560, 0], 70).every(([, , tx]) => tx < 560)).toBe(true);
  });

  test("FR-SCN-61 a wall under a cell long still gets one arrow, no wider than itself", () => {
    const [a] = oneWayArrows([0, 0, 7, 0], 70);
    expect(a?.[0]).toBeCloseTo(0);
    expect(a?.[4]).toBeCloseTo(7);
    expect(oneWayArrows([5, 5, 5, 5], 70)).toEqual([]);
  });

  test("FR-SCN-63 oneWayView leaves only one-way walls to hit", () => {
    const v = oneWayView(structureView(REC));
    expect(v.walls.map((w) => w[0])).toEqual([3, 4]);
    expect(v.doors).toEqual([]);
    expect(hitSegment(v, GRID, { x: 560, y: 70 }, 8)).toBeNull();
    expect(hitSegment(v, GRID, { x: 700, y: 70 }, 8)).toBe(3);
  });
});
