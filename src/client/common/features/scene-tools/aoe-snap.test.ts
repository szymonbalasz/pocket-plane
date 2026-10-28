// AoE origin snap (FR-SCN-43 as amended by DM #375, FR-SCN-20, -45) and the squares a snapped
// origin covers (FR-SCN-41: grid distance for a snapped sphere / cylinder, #377; the exact rule
// otherwise): the pure helper, then through the tool's real pointer handlers with fake senders.
import { afterEach, describe, expect, test } from "bun:test";
import { templateCells } from "@shared/scene-tools/geometry";
import type { TemplateGeometry } from "@shared/scene-tools/schemas";
import { contains, templateArea } from "@shared/scenes-map/area";
import type { SceneView } from "@shared/scenes-map/schemas";
import { emanationCells } from "@shared/spell-fx/cells";
import type { ToolPointer } from "../scenes-map/tools";
import { aoeOrigin, mapCells, snapTokens } from "./aoe-snap";
import { cancelAoe, useAoe } from "./aoe-store";
import { aoeTool, applySettings } from "./aoe-tool";
import {
  cellsAttr,
  DEFAULT_AOE,
  endEdit,
  movedOrigin,
  placeFrame,
  type TemplateView,
  templateHandles,
  templateOutline,
} from "./templates";

const CS = 70;
const G = { gridCellSize: CS, gridOffsetX: 0, gridOffsetY: 0 };
const MAP = { ...G, mapWidth: 1400, mapHeight: 980 };
/** 20 × 14 cells. */
const B = mapCells(MAP);
const snap = { free: false, bounds: B };

/** A Large (2 × 2) at (4, 4), a Huge (3 × 3) at (10, 2), a Medium at (8, 8). */
const TOKENS = snapTokens([
  { col: 4, row: 4, size: "large" },
  { col: 10, row: 2, size: "huge" },
  { col: 8, row: 8, size: "medium" },
]);

describe("FR-SCN-43 origin snap (#375)", () => {
  test("FR-SCN-43 sphere, cylinder, cone and line snap to the centre of the cell under the pointer; the cube to the nearest vertex", () => {
    for (const shape of ["sphere", "cylinder", "cone", "line"] as const) {
      expect(aoeOrigin(shape, { x: 3.37, y: 7.64 }, snap)).toEqual({
        x: 3.5,
        y: 7.5,
        cell: { col: 3, row: 7, n: 1 },
      });
      // Anywhere in the cell, its edges included (a cell is [c, c + 1)).
      expect(aoeOrigin(shape, { x: 3, y: 7.99 }, snap)).toMatchObject({ x: 3.5, y: 7.5 });
    }
    expect(aoeOrigin("cube", { x: 3.37, y: 7.64 }, snap)).toEqual({ x: 3, y: 8, cell: null });
    expect(aoeOrigin("cube", { x: 3.6, y: 7.4 }, snap)).toEqual({ x: 4, y: 7, cell: null });
  });

  test("FR-SCN-43 Ctrl places freely to 0.01 cell for every shape, tokens and map edges ignored", () => {
    const free = { free: true, tokens: TOKENS, bounds: B };
    for (const shape of ["sphere", "cylinder", "cone", "line", "cube"] as const) {
      expect(aoeOrigin(shape, { x: 4.637, y: 5.004 }, free)).toEqual({
        x: 4.64,
        y: 5,
        cell: null,
      });
    }
    expect(aoeOrigin("cone", { x: -0.5, y: 30.123 }, free)).toMatchObject({ x: -0.5, y: 30.12 });
  });

  test("FR-SCN-43 over a 1 × 1 / 2 × 2 / 3 × 3 token a sphere or cylinder snaps to the token's centre; cone, line and cube don't", () => {
    const o = { free: false, tokens: TOKENS, bounds: B };
    for (const shape of ["sphere", "cylinder"] as const) {
      // Large: its centre is the vertex (5, 5), from any of its four cells.
      for (const p of [
        { x: 4.1, y: 4.1 },
        { x: 5.9, y: 4.2 },
        { x: 4.3, y: 5.8 },
        { x: 5.5, y: 5.5 },
      ]) {
        expect(aoeOrigin(shape, p, o)).toEqual({ x: 5, y: 5, cell: { col: 4, row: 4, n: 2 } });
      }
      // Huge: the middle cell's centre.
      expect(aoeOrigin(shape, { x: 12.9, y: 2.1 }, o)).toEqual({
        x: 11.5,
        y: 3.5,
        cell: { col: 10, row: 2, n: 3 },
      });
      // Medium: its own cell's centre (= the cell rule); off the tokens: the cell rule.
      expect(aoeOrigin(shape, { x: 8.2, y: 8.7 }, o)).toMatchObject({ x: 8.5, y: 8.5 });
      expect(aoeOrigin(shape, { x: 6.2, y: 4.5 }, o)).toMatchObject({ x: 6.5, y: 4.5 });
    }
    expect(aoeOrigin("cone", { x: 4.1, y: 4.1 }, o)).toMatchObject({ x: 4.5, y: 4.5 });
    expect(aoeOrigin("line", { x: 12.9, y: 2.1 }, o)).toMatchObject({ x: 12.5, y: 2.5 });
    expect(aoeOrigin("cube", { x: 4.1, y: 4.1 }, o)).toEqual({ x: 4, y: 4, cell: null });
    // Gargantuan (4 × 4): a vertex again; the topmost (last drawn) containing token wins.
    const g = snapTokens([
      { col: 0, row: 0, size: "gargantuan" },
      { col: 2, row: 2, size: "large" },
    ]);
    expect(aoeOrigin("sphere", { x: 0.5, y: 3.5 }, { free: false, tokens: g })).toMatchObject({
      x: 2,
      y: 2,
    });
    expect(aoeOrigin("sphere", { x: 3.5, y: 3.5 }, { free: false, tokens: g })).toMatchObject({
      x: 3,
      y: 3,
    });
  });

  test("FR-SCN-43 map edges: a snapped origin stays on the map's cells (part cells of an offset grid count)", () => {
    expect(B).toEqual({ c0: 0, r0: 0, c1: 19, r1: 13 });
    expect(aoeOrigin("sphere", { x: 20, y: 14 }, snap)).toMatchObject({ x: 19.5, y: 13.5 });
    expect(aoeOrigin("cone", { x: -2.3, y: 25 }, snap)).toMatchObject({ x: 0.5, y: 13.5 });
    expect(aoeOrigin("line", { x: 19.99, y: 0 }, snap)).toMatchObject({ x: 19.5, y: 0.5 });
    expect(aoeOrigin("cube", { x: 23.2, y: -1.6 }, snap)).toEqual({ x: 20, y: 0, cell: null });
    // Unclamped without bounds (as sprint 4's vertex snap).
    expect(aoeOrigin("sphere", { x: 20.2, y: 3 }, { free: false })).toMatchObject({ x: 20.5 });
    // Offset 20 px on a 70 px grid, 1000 × 700 map: part cells at both edges.
    const off = mapCells({
      gridCellSize: 70,
      gridOffsetX: 20,
      gridOffsetY: 20,
      mapWidth: 1000,
      mapHeight: 700,
    });
    expect(off).toEqual({ c0: -1, r0: -1, c1: 13, r1: 9 });
    expect(aoeOrigin("sphere", { x: -3, y: -3 }, { free: false, bounds: off })).toMatchObject({
      x: -0.5,
      y: -0.5,
    });
  });

  test("FR-SCN-45 a kept template's origin move uses the same snap (cell centre, token centre, cube vertex)", () => {
    const o = { free: false, tokens: TOKENS, bounds: B };
    const press = { x: 2, y: 2 };
    expect(movedOrigin("cone", press, { x: 2.05, y: 2 }, o)).toBeNull();
    expect(movedOrigin("cone", press, { x: 6.2, y: 1.1 }, o)).toMatchObject({ x: 6.5, y: 1.5 });
    expect(movedOrigin("sphere", press, { x: 4.2, y: 5.1 }, o)).toMatchObject({ x: 5, y: 5 });
    expect(movedOrigin("cube", press, { x: 4.2, y: 5.1 }, o)).toMatchObject({ x: 4, y: 5 });
    expect(movedOrigin("sphere", press, { x: 4.234, y: 5.1 }, { ...o, free: true })).toMatchObject({
      x: 4.23,
      y: 5.1,
      cell: null,
    });
  });
});

// ---------- coverage from snapped origins (FR-SCN-41, exact rule unchanged by #375) ----------

const cells = (t: TemplateGeometry) => templateCells(t, MAP, { cut: true });
/** The cells as an ASCII block over [c0, c1] × [r0, r1] ("#" covered). */
function block(t: TemplateGeometry, c0: number, r0: number, c1: number, r1: number): string[] {
  const set = new Set(cells(t).map(([c, r]) => `${c},${r}`));
  const rows: string[] = [];
  for (let r = r0; r <= r1; r++) {
    let line = "";
    for (let c = c0; c <= c1; c++) line += set.has(`${c},${r}`) ? "#" : ".";
    rows.push(line);
  }
  return rows;
}
/** Covered cells mirrored through the centre of cell (cc, cr) (both axes and the diagonal). */
function symmetric(t: TemplateGeometry, cc: number, cr: number): boolean {
  const set = new Set(cells(t).map(([c, r]) => `${c},${r}`));
  return [...set].every((k) => {
    const [c, r] = k.split(",").map(Number) as [number, number];
    const [dc, dr] = [c - cc, r - cr];
    return [
      [-dc, dr],
      [dc, -dr],
      [dr, dc],
    ].every(([a, b]) => set.has(`${cc + (a as number)},${cr + (b as number)}`));
  });
}

describe("FR-SCN-41 coverage from a snapped origin (#375, #377)", () => {
  test("FR-SCN-41 #377 ruling: the campaign's diagonal rule (as the ruler): 10 / 20 ft from a square and from a Large token, sphere and cylinder, under `5-10-5` and `5`", () => {
    const square = { x: 10.5, y: 6.5, angle: 0, footprint: 1 };
    const large = { x: 11, y: 7, angle: 0, footprint: 2 };
    const n = (t: TemplateGeometry, rule: "5-10-5" | "5") =>
      templateCells(t, MAP, { cut: true, rule }).length;
    for (const shape of ["sphere", "cylinder"] as const) {
      // 5/10/5 (the default): corners trimmed.
      expect(n({ shape, ...square, size: 10 }, "5-10-5")).toBe(21);
      expect(n({ shape, ...square, size: 20 }, "5-10-5")).toBe(61);
      expect(n({ shape, ...large, size: 10 }, "5-10-5")).toBe(32);
      expect(n({ shape, ...large, size: 20 }, "5-10-5")).toBe(80);
      // 5-ft diagonals: full squares (10 ft = 5 × 5).
      expect(n({ shape, ...square, size: 10 }, "5")).toBe(25);
      expect(n({ shape, ...square, size: 20 }, "5")).toBe(81);
      expect(n({ shape, ...large, size: 10 }, "5")).toBe(36);
      expect(n({ shape, ...large, size: 20 }, "5")).toBe(100);
    }
    const s10 = { shape: "sphere" as const, ...square, size: 10 };
    expect(cellsAttr(templateCells(s10, MAP, { cut: true, rule: "5" })).split(" ")).toHaveLength(
      25,
    );
    expect(cells(s10)).toEqual(templateCells(s10, MAP, { cut: true, rule: "5-10-5" }));
    // The outline follows the rule: a plain square under `5`.
    expect(templateArea(s10, "5")).toEqual({ polygon: [13, 4, 13, 9, 8, 9, 8, 4] });
    const o = templateOutline(s10, G, "5");
    expect(o.kind === "poly" && o.points).toEqual([910, 280, 910, 630, 560, 630, 560, 280]);
    // A Ctrl-free sphere (no footprint) ignores the rule: the exact > 50 % rule.
    const free = { ...s10, footprint: undefined };
    expect(n(free, "5")).toBe(n(free, "5-10-5"));
  });

  test("FR-SCN-41 #377 a sphere snapped to a square covers grid distance (5/10/5) ≤ radius: 10 ft = 21 (5 × 5 minus corners), 15 ft = 37, 20 ft = 61; symmetric", () => {
    const s10 = { shape: "sphere" as const, x: 10.5, y: 6.5, size: 10, angle: 0, footprint: 1 };
    expect(cells(s10)).toHaveLength(21);
    expect(block(s10, 7, 3, 13, 9)).toEqual([
      ".......",
      "..###..",
      ".#####.",
      ".#####.",
      ".#####.",
      "..###..",
      ".......",
    ]);
    expect(symmetric(s10, 10, 6)).toBe(true);
    expect(cells({ ...s10, size: 15 })).toHaveLength(37);
    const s20 = { ...s10, size: 20 };
    expect(cells(s20)).toHaveLength(61);
    expect(block(s20, 6, 2, 14, 10)).toEqual([
      "...###...",
      ".#######.",
      ".#######.",
      "#########",
      "#########",
      "#########",
      ".#######.",
      ".#######.",
      "...###...",
    ]);
    expect(symmetric(s20, 10, 6)).toBe(true);
    // A cylinder covers the same; = Spell FX's emanation (FR-VFX-24) plus the origin square.
    expect(cells({ ...s20, shape: "cylinder" })).toEqual(cells(s20));
    const fx = emanationCells({ col: 10, row: 6, side: 1 }, 20, MAP).map(
      (c) => `${c.col},${c.row}`,
    );
    const own = cells(s20).map(([c, r]) => `${c},${r}`);
    expect(own.filter((k) => k !== "10,6")).toEqual(fx);
  });

  test("FR-SCN-41 #377 a sphere snapped to a Large (2 × 2) / Huge (3 × 3) token measures from the whole footprint, footprint included", () => {
    const large = { shape: "sphere" as const, x: 5, y: 5, size: 10, angle: 0, footprint: 2 };
    expect(block(large, 2, 2, 7, 7)).toEqual([
      ".####.",
      "######",
      "######",
      "######",
      "######",
      ".####.",
    ]);
    const huge = { shape: "cylinder" as const, x: 11.5, y: 3.5, size: 5, angle: 0, footprint: 3 };
    expect(block(huge, 9, 1, 13, 5)).toEqual(Array(5).fill("#####"));
    expect(cells({ ...huge, size: 10 })).toHaveLength(45);
  });

  test("FR-SCN-41 #377 cut to the map for drawing, uncut for fog; a Ctrl-free sphere (no footprint) keeps the exact rule", () => {
    const corner = { shape: "sphere" as const, x: 0.5, y: 0.5, size: 10, angle: 0, footprint: 1 };
    expect(cells(corner)).toHaveLength(8);
    expect(templateCells(corner, MAP, { cut: false })).toHaveLength(21);
    // The same point without a footprint (Ctrl): > 50 % covered, the 3 × 3 block.
    const free = { shape: "sphere" as const, x: 10.5, y: 6.5, size: 10, angle: 0 };
    expect(block(free, 8, 4, 12, 8)).toEqual([".....", ".###.", ".###.", ".###.", "....."]);
    expect(block({ ...free, x: 5, y: 5 }, 3, 3, 6, 6)).toEqual([".##.", "####", "####", ".##."]);
  });

  test("FR-SCN-20 #377 a snapped sphere's outline is the stepped edge of its squares (hit test and end handle too)", () => {
    const s10 = { shape: "sphere" as const, x: 10.5, y: 6.5, size: 10, angle: 0, footprint: 1 };
    const area = templateArea(s10);
    expect(area).toEqual({
      polygon: [12, 4, 12, 5, 13, 5, 13, 8, 12, 8, 12, 9, 9, 9, 9, 8, 8, 8, 8, 5, 9, 5, 9, 4],
    });
    for (const [c, r] of cells(s10)) expect(contains(area, c + 0.5, r + 0.5)).toBe(true);
    expect(contains(area, 8.5, 4.5)).toBe(false);
    const o = templateOutline(s10, G);
    expect(o.kind === "poly" && o.points.slice(0, 4)).toEqual([840, 280, 840, 350]);
    // The end handle sits on the stepped edge; dragging it measures the radius from there.
    expect(templateHandles(s10).end).toEqual({ x: 13, y: 6.5 });
    expect(endEdit(s10, { x: 14.1, y: 6.5 }, false).size).toBe(15);
    expect(templateHandles({ ...s10, footprint: undefined }).end).toEqual({ x: 12.5, y: 6.5 });
  });

  test("FR-SCN-41 a cone and a line from a cell centre", () => {
    const at = { x: 10.5, y: 6.5 };
    // 15-ft cone east: the axis splits row 6's cells; ties count right of the axis (south).
    expect(cellsAttr(cells({ shape: "cone", ...at, size: 15, angle: 0 }))).toBe("11,6 12,6 12,7");
    // 15-ft cone south-east (45°): the 2 × 2 block beyond the origin cell.
    expect(cellsAttr(cells({ shape: "cone", ...at, size: 15, angle: 45 }))).toBe(
      "11,7 12,7 11,8 12,8",
    );
    // 30-ft line: 5 whole cells; the half-covered origin and end cells are ties on the axis.
    expect(cellsAttr(cells({ shape: "line", ...at, size: 30, width: 5, angle: 0 }))).toBe(
      "11,6 12,6 13,6 14,6 15,6",
    );
    expect(cellsAttr(cells({ shape: "line", ...at, size: 30, width: 5, angle: 90 }))).toBe(
      "10,7 10,8 10,9 10,10 10,11",
    );
  });

  test("FR-SCN-41 a cube with its corner on a vertex covers whole cells (every quadrant)", () => {
    const at = { x: 10, y: 6 };
    expect(cellsAttr(cells({ shape: "cube", ...at, size: 10, angle: 0 }))).toBe(
      "10,6 11,6 10,7 11,7",
    );
    expect(cellsAttr(cells({ shape: "cube", ...at, size: 15, angle: 270 }))).toBe(
      "10,3 11,3 12,3 10,4 11,4 12,4 10,5 11,5 12,5",
    );
    for (const angle of [0, 90, 180, 270]) {
      expect(cells({ shape: "cube", ...at, size: 15, angle })).toHaveLength(9);
    }
  });
});

// ---------- through the tool (placing, highlight, panel re-snap) ----------

const SCENE = { id: "s1", mapWidth: MAP.mapWidth, mapHeight: MAP.mapHeight } as SceneView;

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
    intent: () => Promise.resolve({}),
    signal: () => {},
  };
}

const P = aoeTool.pointer as Required<NonNullable<typeof aoeTool.pointer>>;

afterEach(() => {
  cancelAoe("unmount");
  useAoe.setState({ settings: DEFAULT_AOE, editable: [], selectedId: null, tokens: [] });
});

describe("FR-SCN-43 placing (#375)", () => {
  test("FR-SCN-43 the origin cells are highlighted while placing (a cell, a token), not with Ctrl or a cube; cleared on release", () => {
    useAoe.setState({ tokens: TOKENS, settings: { ...DEFAULT_AOE, shape: "sphere", size: 20 } });
    P.down(pt(6.2, 1.7));
    expect(useAoe.getState().originCell).toEqual({ col: 6, row: 1, n: 1 });
    expect(useAoe.getState().own?.template).toMatchObject({
      x: 6.5,
      y: 1.5,
      size: 20,
      footprint: 1,
    });
    P.move(pt(6.3, 1.9, true));
    expect(useAoe.getState().originCell).toBeNull();
    expect(useAoe.getState().own?.template.footprint).toBeUndefined();
    P.up(pt(6.3, 1.9));
    expect(useAoe.getState().originCell).toBeNull();

    // Over the Large token: its centre, its 2 × 2 footprint highlighted; the drag sets the radius
    // from the footprint's edge, so the stepped outline meets the pointer (#377).
    P.down(pt(4.2, 5.7));
    expect(useAoe.getState().originCell).toEqual({ col: 4, row: 4, n: 2 });
    P.move(pt(8, 5));
    const t = useAoe.getState().own?.template as TemplateView;
    expect(t).toMatchObject({ x: 5, y: 5, size: 10, footprint: 2 });
    // The signal carries it, so receivers compute the same squares.
    expect(placeFrame("s1", "k", t, false)).toMatchObject({ footprint: 2 });
    P.up(pt(8, 5));
    expect(useAoe.getState().originCell).toBeNull();

    useAoe.setState({ settings: { ...DEFAULT_AOE, shape: "cube", size: 10 } });
    P.down(pt(4.2, 5.7));
    expect(useAoe.getState().originCell).toBeNull();
    expect(useAoe.getState().own?.template).toMatchObject({ x: 4, y: 6 });
    cancelAoe("escape");
    expect(useAoe.getState().originCell).toBeNull();
  });

  test("FR-SCN-22 a press without a drag keeps the panel's size, wherever in the cell", () => {
    useAoe.setState({ settings: { ...DEFAULT_AOE, shape: "sphere", size: 20 } });
    P.down(pt(3.02, 3.03));
    P.up(pt(3.05, 3.03));
    expect(useAoe.getState().own?.template).toMatchObject({ x: 3.5, y: 3.5, size: 20 });
  });

  test("FR-SCN-43 a panel shape change re-snaps the ephemeral's origin from its press (cell centre ↔ vertex ↔ token centre)", () => {
    useAoe.setState({ tokens: TOKENS, settings: { ...DEFAULT_AOE, shape: "sphere", size: 20 } });
    P.down(pt(4.2, 4.3));
    P.up(pt(4.2, 4.3));
    expect(useAoe.getState().own?.template).toMatchObject({ x: 5, y: 5, footprint: 2 });
    applySettings({ shape: "cone" });
    expect(useAoe.getState().own?.template).toMatchObject({ shape: "cone", x: 4.5, y: 4.5 });
    expect(useAoe.getState().own?.template.footprint).toBeUndefined();
    applySettings({ shape: "cube" });
    expect(useAoe.getState().own?.template).toMatchObject({ shape: "cube", x: 4, y: 4 });
    applySettings({ shape: "cylinder" });
    const cyl = useAoe.getState().own?.template;
    expect(cyl).toMatchObject({ shape: "cylinder", x: 5, y: 5, footprint: 2 });
    // A size change keeps the origin.
    applySettings({ size: 30 });
    expect(useAoe.getState().own?.template).toMatchObject({ x: 5, y: 5, size: 30 });
    // A Ctrl placement stays free.
    P.down(pt(7.23, 2.41, true));
    P.up(pt(7.23, 2.41, true));
    applySettings({ shape: "line" });
    expect(useAoe.getState().own?.template).toMatchObject({ shape: "line", x: 7.23, y: 2.41 });
  });
});
