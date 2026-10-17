// Sprint 4 AoE tool (SCN FR-SCN-41–45): snapped unless Ctrl, the end handle, the Clear templates
// scope and the drawn squares, through the tool's real pointer handlers with fake senders.
import { afterEach, describe, expect, test } from "bun:test";
import { templateCells } from "@shared/scene-tools/geometry";
import type { TemplateRecordView } from "@shared/scene-tools/schemas";
import type { SceneView } from "@shared/scenes-map/schemas";
import type { ToolPointer } from "../scenes-map/tools";
import { cancelAoe, useAoe } from "./aoe-store";
import { aoeCtrl, aoeTool } from "./aoe-tool";
import { chipShown } from "./free-chip";
import { freeChipShown } from "./structure-tool";
import {
  cellsAttr,
  clearConfirmEnabled,
  clearCounts,
  clearInput,
  clearScopeCount,
  clearTitle,
  DEFAULT_AOE,
  handleAt,
  templateCaption,
  templateHandles,
  templateOutline,
} from "./templates";

const CS = 70;
const G = { gridCellSize: CS, gridOffsetX: 0, gridOffsetY: 0 };
const MAP = { ...G, mapWidth: 1400, mapHeight: 980 };
const SCENE = { id: "s1" } as SceneView;

const intents: { name: string; input: unknown }[] = [];
const frames: unknown[] = [];

/** A stage pointer event at grid point (gx, gy). */
function pt(gx: number, gy: number, ctrl = false): ToolPointer {
  const x = gx * CS;
  const y = gy * CS;
  return {
    x,
    y,
    cell: { col: Math.floor(gx), row: Math.floor(gy) },
    vertex: { x: Math.round(gx), y: Math.round(gy) },
    screen: { x, y },
    button: 0,
    ctrl,
    shift: false,
    alt: false,
    clicks: 1,
    client: "dm",
    scene: SCENE,
    grid: G,
    intent: (name, input) => {
      intents.push({ name, input });
      return Promise.resolve({});
    },
    signal: (_name, data) => {
      frames.push(data);
    },
  };
}

const P = aoeTool.pointer as Required<NonNullable<typeof aoeTool.pointer>>;
const drag = (from: ToolPointer, ...rest: ToolPointer[]) => {
  P.down(from);
  for (const e of rest) P.move(e);
  P.up(rest.at(-1) ?? from);
};

const kept = (over: Partial<TemplateRecordView>): TemplateRecordView => ({
  id: "t1",
  sceneId: "s1",
  shape: "cone",
  x: 2,
  y: 2,
  size: 15,
  width: null,
  angle: 0,
  label: "",
  placedByPlayerId: null,
  hidden: false,
  ...over,
});

afterEach(() => {
  cancelAoe("unmount");
  useAoe.setState({ settings: DEFAULT_AOE, editable: [], selectedId: null, gesture: null });
  intents.length = 0;
  frames.length = 0;
});

describe("FR-SCN-43 snapped unless Ctrl", () => {
  test("FR-SCN-43 gestures: Ctrl per move (origin 0.01 cell, angle 0.1°), else vertex + 15°; the spec's Ctrl cone = 4 golden squares", async () => {
    useAoe.setState({
      settings: { ...DEFAULT_AOE, shape: "cone", size: 15, label: "Burning Hands" },
    });
    // Walkthrough M2: Ctrl, press (3.37, 7.64), drag to (5.75, 9.47).
    drag(pt(3.37, 7.64, true), pt(4.5, 8.5, true), pt(5.75, 9.47, true));
    const free = useAoe.getState().own?.template;
    expect(free).toMatchObject({ shape: "cone", x: 3.37, y: 7.64, size: 15, angle: 37.6 });
    expect(templateCells(free as NonNullable<typeof free>, MAP, { cut: true })).toEqual([
      [4, 8],
      [5, 8],
      [4, 9],
      [5, 9],
    ]);
    // The golden itself (37.5°) covers the same squares.
    expect(
      templateCells({ shape: "cone", x: 3.37, y: 7.64, size: 15, angle: 37.5 }, MAP, { cut: true }),
    ).toHaveLength(4);
    // The signal carries the decimals as drawn (receivers compute the same squares; ≤ 20 / s).
    await Bun.sleep(60);
    expect(frames.at(-1)).toMatchObject({ x: 3.37, y: 7.64, angle: 37.6, label: "Burning Hands" });

    // No Ctrl: the nearest vertex and 15° steps.
    drag(pt(3.37, 7.64), pt(5.75, 9.47));
    expect(useAoe.getState().own?.template).toMatchObject({ x: 3, y: 8, angle: 30 });

    // Ctrl read on every move: pressed without, held from the first move on.
    P.down(pt(3.37, 7.64));
    expect(useAoe.getState().own?.template).toMatchObject({ x: 3, y: 8 });
    P.move(pt(5.75, 9.47, true));
    expect(useAoe.getState().own?.template).toMatchObject({ x: 3.37, y: 7.64, angle: 37.6 });
    // Released without a move: the gesture re-snaps.
    aoeCtrl(false);
    expect(useAoe.getState().own?.template).toMatchObject({ x: 3, y: 8, angle: 30 });
    P.up(pt(5.75, 9.47));
  });

  test("FR-SCN-43 a snapped 30-ft line from vertex (10, 7) east = 6 squares (one-side tie rule)", () => {
    useAoe.setState({ settings: { ...DEFAULT_AOE, shape: "line", size: 30 } });
    drag(pt(10.2, 6.9), pt(13, 7.1), pt(16, 7.1));
    const t = useAoe.getState().own?.template;
    expect(t).toMatchObject({ x: 10, y: 7, angle: 0, width: 5 });
    expect(cellsAttr(templateCells(t as NonNullable<typeof t>, MAP, { cut: true }))).toBe(
      "10,7 11,7 12,7 13,7 14,7 15,7",
    );
  });

  test("FR-SCN-43 radius rounds to 5 ft, with or without Ctrl; a cube aims its diagonal", () => {
    useAoe.setState({ settings: { ...DEFAULT_AOE, shape: "sphere", size: 20 } });
    drag(pt(5, 5), pt(7.3, 5));
    expect(useAoe.getState().own?.template).toMatchObject({ x: 5, y: 5, size: 10 });
    drag(pt(5.03, 5.04, true), pt(8.2, 5.04, true));
    expect(useAoe.getState().own?.template).toMatchObject({ x: 5.03, y: 5.04, size: 15 });
    useAoe.setState({ settings: { ...DEFAULT_AOE, shape: "cube", size: 15 } });
    drag(pt(4, 4), pt(7, 1));
    expect(useAoe.getState().own?.template).toMatchObject({ shape: "cube", angle: 270 }); // NE
    drag(pt(4, 4, true), pt(7, 6, true));
    expect(useAoe.getState().own?.template.angle).toBe(348.7);
  });

  test("FR-SCN-43 Free chip: AoE shows it while Ctrl is held over the map; Structure only in Wall / Door", () => {
    expect(chipShown(true, true, true)).toBe(true);
    expect(chipShown(true, false, true)).toBe(false);
    expect(chipShown(true, true, false)).toBe(false);
    expect(freeChipShown("wall", true, true)).toBe(true);
    expect(freeChipShown("erase", true, true)).toBe(false);
  });
});

describe("FR-SCN-45 handles", () => {
  test("FR-SCN-45 handles: origin drag moves (vertex, or 0.01 cell with Ctrl); one update on release; a click only selects", () => {
    useAoe.setState({ editable: [kept({})] });
    drag(pt(2.1, 2.05));
    expect(useAoe.getState().selectedId).toBe("t1");
    expect(intents).toEqual([]);
    drag(pt(2.1, 2.05), pt(3, 2.5), pt(4.4, 3.3));
    expect(intents).toEqual([
      { name: "scn.updateTemplate", input: { templateId: "t1", x: 4, y: 3 } },
    ]);
    drag(pt(1.95, 2.1), pt(4.43, 3.31, true));
    expect(intents.at(-1)?.input).toEqual({ templateId: "t1", x: 4.43, y: 3.31 });
    expect(intents).toHaveLength(2);
    expect(useAoe.getState().own).toBeNull();
  });

  test("FR-SCN-45 handles: the selected template's end handle re-aims a cone / cube or resizes a sphere (15° / Ctrl 0.1°, 5-ft steps)", () => {
    const cone = kept({});
    expect(templateHandles(cone)).toEqual({ origin: { x: 2, y: 2 }, end: { x: 5, y: 2 } });
    useAoe.setState({ editable: [cone], selectedId: null });
    // Not selected: a press on the end point places a new ephemeral instead.
    expect(handleAt(cone, { x: 5.1, y: 2.1 }, false)).toBeNull();
    useAoe.setState({ settings: { ...DEFAULT_AOE, shape: "sphere" } });
    drag(pt(5.1, 2.1));
    expect(useAoe.getState().own).not.toBeNull();
    expect(intents).toEqual([]);
    cancelAoe("escape");

    useAoe.setState({ selectedId: "t1" });
    P.down(pt(5.1, 2.1));
    P.move(pt(2.2, 5));
    // Local preview only until release.
    expect(useAoe.getState().gesture).toMatchObject({ kind: "end", template: { angle: 90 } });
    expect(intents).toEqual([]);
    P.up(pt(2.2, 5));
    expect(intents).toEqual([
      { name: "scn.updateTemplate", input: { templateId: "t1", angle: 90 } },
    ]);
    drag(pt(4.9, 2), pt(4, 4.4, true));
    expect(intents.at(-1)?.input).toEqual({ templateId: "t1", angle: 50.2 });

    const sphere = kept({ id: "t2", shape: "sphere", x: 6, y: 6, size: 10 });
    useAoe.setState({ editable: [sphere], selectedId: "t2" });
    drag(pt(8, 6), pt(10.4, 6));
    expect(intents.at(-1)?.input).toEqual({ templateId: "t2", size: 20 });

    const cube = kept({ id: "t3", shape: "cube", x: 1, y: 8, size: 10 });
    expect(templateHandles(cube).end).toEqual({ x: 3, y: 10 });
    useAoe.setState({ editable: [cube], selectedId: "t3" });
    drag(pt(3, 10), pt(4, 5));
    expect(intents.at(-1)?.input).toEqual({ templateId: "t3", angle: 270 });
    // Released where it started: nothing sent.
    const n = intents.length;
    drag(pt(3, 10.05), pt(3, 10));
    expect(intents).toHaveLength(n);
  });
});

describe("FR-SCN-44 Clear templates dialog", () => {
  test("FR-SCN-44 dialog: counts per scope, Confirm disabled at 0 or offline, players only when ticked", () => {
    const rows = [
      kept({ id: "a", label: "Spirit Guardians", placedByPlayerId: "p1" }),
      kept({ id: "b", label: "Glyph", hidden: true }),
      kept({ id: "c", label: "Thunderwave", placedByPlayerId: "p2" }),
      kept({ id: "d", label: "Web" }),
      kept({ id: "e", label: "Burning Hands", placedByPlayerId: "p1" }),
      kept({ id: "f", sceneId: "s2" }),
    ];
    const c = clearCounts(rows, "s1");
    expect(c).toEqual({ dm: 2, players: 3 });
    expect(clearTitle(c.dm)).toBe("Clear 2 DM templates on this scene?");
    expect(clearTitle(1)).toBe("Clear 1 DM template on this scene?");
    expect([clearScopeCount(c, false), clearScopeCount(c, true)]).toEqual([2, 5]);
    expect(clearInput("s1", false)).toEqual({ sceneId: "s1" });
    expect(clearInput("s1", true)).toEqual({ sceneId: "s1", players: true });
    // After a DM-only clear: Confirm disabled until the box is ticked.
    const after = clearCounts(
      rows.filter((r) => r.placedByPlayerId !== null),
      "s1",
    );
    expect(clearConfirmEnabled(clearScopeCount(after, false), true)).toBe(false);
    expect(clearConfirmEnabled(clearScopeCount(after, true), true)).toBe(true);
    // Not live (FR-SCN-34): nothing can be sent.
    expect(clearConfirmEnabled(5, false)).toBe(false);
  });
});

describe("FR-SCN-21 drawing", () => {
  test("FR-SCN-21 the cells attr lists the squares row-major; the caption counts them; Thunderwave = 8", () => {
    const thunderwave = { shape: "cube" as const, x: 1.5, y: 10.5, size: 15, angle: 300 };
    const cells = templateCells(thunderwave, MAP, { cut: true });
    expect(cellsAttr(cells)).toBe("3,8 2,9 3,9 4,9 2,10 3,10 4,10 3,11");
    expect(templateCaption("Thunderwave", cells.length)).toBe("Thunderwave · 8 squares");
    expect(templateCaption("Burning Hands", 0)).toBe("Burning Hands · 0 squares");
  });

  test("FR-SCN-20 a cube's outline is rotated: sides along angle and angle + 90°", () => {
    const o = templateOutline({ shape: "cube", x: 0, y: 0, size: 10, angle: 300 }, G);
    const pts = o.kind === "poly" ? o.points.map((v) => Math.round(v * 100) / 100 + 0) : [];
    // u = (cos 300°, sin 300°) = (0.5, −0.866), n = u rotated +90° = (0.866, 0.5); side 140 px.
    expect(pts).toEqual([0, 0, 70, -121.24, 191.24, -51.24, 121.24, 70]);
  });
});
