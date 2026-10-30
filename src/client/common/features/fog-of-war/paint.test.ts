// FOG §13 client unit rows: FR-FOG-20/21 painter (V1, static). A tiny software rasteriser stands in
// for the canvas (pixel centres, source-over / destination-out, clip), so the tests read what a
// pixel ends up showing: painter order over the base mask, DM alphas, player darkness only where
// statically clear (never over Fog or Explored), the `fog-mask` attrs, DM darkness hatching, the
// `fog-vision` / `fog-explored` markers.
import { describe, expect, test } from "bun:test";
import { encodeRuns } from "@shared/fog-of-war/mask";
import type { DarknessShape, FogLayerShape } from "@shared/fog-of-war/shapes";
import { EdgePixel, Raster } from "./paint-raster";
import {
  FOG_ALPHA,
  type FogPaints,
  fogStats,
  ownFogRows,
  type PaintCtx,
  paintDarknessDm,
  paintFog,
} from "./render";

/** 10 × 6 cells of 10 px. */
const map = { mapWidth: 100, mapHeight: 60, gridCellSize: 10, gridOffsetX: 0, gridOffsetY: 0 };
const paints = (client: "dm" | "player"): FogPaints => ({
  fog: { color: "F", alpha: FOG_ALPHA[client].fog },
  explored: { color: "E", alpha: FOG_ALPHA[client].explored },
  darkness: { color: "D", alpha: FOG_ALPHA[client].darkness },
});
/** What the centre of cell (c, r) shows. */
const cell = (r: Raster, c: number, row: number) => r.at(c * 10 + 5, row * 10 + 5);
const label = (r: Raster, c: number, row: number) => cell(r, c, row).label;

const shapes: FogLayerShape[] = [
  { op: "reveal", rect: [0, 0, 6, 6] },
  { op: "explored", polygon: [1, 1, 4, 1, 4, 4, 1, 4] },
  { op: "fog", circle: [2, 2, 0.75] },
];
const fogged = {
  fill: "fog" as const,
  box: [0, 0, 10, 6] as [number, number, number, number],
  runs: "",
};

describe("FR-FOG-20/21 painter", () => {
  test("FR-FOG-20 DM: base mask, then shapes in list order override (Fog ≈ 50 %, Explored ≈ 25 %); darkness is not in the mask", () => {
    const r = new Raster(100, 60);
    const darkness: DarknessShape[] = [{ id: "d", circle: [8, 3, 1] }];
    paintFog(r, { ...fogged, shapes, darkness }, map, "dm", paints("dm"));
    expect(cell(r, 8, 3)).toEqual({ label: "F", alpha: 0.5 }); // base fog, darkness drawn elsewhere
    expect(label(r, 5, 5)).toBeNull(); // revealed
    expect(cell(r, 3, 3)).toEqual({ label: "E", alpha: 0.25 }); // explored over the reveal
    expect(cell(r, 2, 2)).toEqual({ label: "F", alpha: 0.5 }); // fog circle over the explored
    expect(r.globalCompositeOperation).toBe("source-over");
    expect(r.strokes).toBe(0);
    // FR-FOG-20: shape edges as one hairline stroke for the DM; never for players.
    const edged = new Raster(100, 60);
    paintFog(edged, { ...fogged, shapes }, map, "dm", paints("dm"), 1);
    expect(edged.strokes).toBe(1);
    const player = new Raster(100, 60);
    paintFog(player, { ...fogged, shapes }, map, "player", paints("player"), 1);
    expect(player.strokes).toBe(0);
  });

  test("FR-FOG-20 a brush shape draws no hairline: its path is a union of circles, quads or cells", () => {
    const brush: FogLayerShape[] = [
      { op: "fog", stroke: [2, 1, 1, 8, 4] },
      { op: "reveal", cells: { box: [0, 0, 2, 1], runs: "1,1" } },
    ];
    const r = new Raster(100, 60);
    paintFog(r, { ...fogged, shapes: brush }, map, "dm", paints("dm"), 1);
    expect(r.strokes).toBe(0);
    const mixed = new Raster(100, 60);
    const rect: FogLayerShape = { op: "fog", rect: [0, 0, 2, 2] };
    paintFog(mixed, { ...fogged, shapes: [...brush, rect] }, map, "dm", paints("dm"), 1);
    expect(mixed.strokes).toBe(1);
  });

  describe("FR-FOG-20/21 no seam on an edge between equal states", () => {
    const fogCircle: FogLayerShape = { op: "fog", circle: [3, 3, 2] };
    const exploredCircle: FogLayerShape = { op: "explored", circle: [3, 3, 2] };
    const exploredAll: FogLayerShape = { op: "explored", rect: [0, 0, 10, 6] };
    for (const client of ["dm", "player"] as const) {
      const a = FOG_ALPHA[client];
      for (const c of [0.25, 0.5, 0.75]) {
        test(`FR-FOG-20/21 ${client}: Fog over Fog at coverage ${c}`, () => {
          const px = new EdgePixel(c);
          paintFog(px, { ...fogged, shapes: [fogCircle] }, map, client, paints(client));
          expect(px.alpha).toBeCloseTo(a.fog, 6);
        });
        test(`FR-FOG-20/21 ${client}: Explored over Explored at coverage ${c}`, () => {
          const px = new EdgePixel(c);
          const rec = { ...fogged, shapes: [exploredAll, exploredCircle] };
          paintFog(px, rec, map, client, paints(client));
          expect(px.alpha).toBeCloseTo(a.explored, 6);
        });
        test(`FR-FOG-37 ${client}: Fog over explored memory at coverage ${c}`, () => {
          const px = new EdgePixel(c, true);
          const rec = { ...fogged, shapes: [fogCircle] };
          paintFog(px, rec, map, client, paints(client), 0, [[0, 0, 100, 60]]);
          expect(px.alpha).toBeCloseTo(a.explored, 6);
        });
      }
    }
  });

  test("FR-FOG-37 memory cells draw Explored and the rest Fog, in the base and in a fog shape", () => {
    const r = new Raster(100, 60);
    const rec = { ...fogged, shapes: [{ op: "fog", rect: [0, 3, 10, 6] } as FogLayerShape] };
    paintFog(r, rec, map, "player", paints("player"), 0, [[0, 0, 40, 60]]);
    expect(cell(r, 1, 1)).toEqual({ label: "E", alpha: 0.6 }); // base, memory
    expect(cell(r, 6, 1)).toEqual({ label: "F", alpha: 1 }); // base
    expect(cell(r, 1, 4)).toEqual({ label: "E", alpha: 0.6 }); // shape, memory
    expect(cell(r, 6, 4)).toEqual({ label: "F", alpha: 1 }); // shape
  });

  test("FR-FOG-21 player: Fog opaque, Explored dims; darkness only where statically clear, never over Fog or Explored", () => {
    const r = new Raster(100, 60);
    const darkness: DarknessShape[] = [
      { id: "a", rect: [4, 0, 10, 6] }, // over the reveal (cols 4, 5), base fog (6–9)
      { id: "b", circle: [3, 3, 1] }, // over the explored polygon
    ];
    paintFog(r, { ...fogged, shapes, darkness }, map, "player", paints("player"));
    expect(cell(r, 5, 5)).toEqual({ label: "D", alpha: 1 }); // revealed + darkness
    expect(cell(r, 4, 5)).toEqual({ label: "D", alpha: 1 });
    expect(cell(r, 7, 2)).toEqual({ label: "F", alpha: 1 }); // base fog wins over darkness
    expect(cell(r, 3, 3)).toEqual({ label: "E", alpha: 0.6 }); // explored wins over darkness
    expect(cell(r, 2, 2)).toEqual({ label: "F", alpha: 1 });
    expect(label(r, 0, 5)).toBeNull(); // revealed, no darkness
  });

  test("FR-FOG-21 a reveal after a fog shape restores darkness inside it; a clear base needs no erase", () => {
    const r = new Raster(100, 60);
    paintFog(
      r,
      {
        fill: "clear",
        box: [0, 0, 10, 6],
        runs: "",
        shapes: [
          { op: "fog", rect: [0, 0, 10, 6] },
          { op: "reveal", circle: [5, 3, 1.5] },
        ],
        darkness: [{ id: "d", rect: [4, 2, 7, 4] }],
      },
      map,
      "player",
      paints("player"),
    );
    expect(label(r, 5, 3)).toBe("D");
    expect(label(r, 4, 3)).toBe("D"); // inside the reveal circle and the darkness
    expect(label(r, 1, 1)).toBe("F");
    expect(label(r, 6, 3)).toBe("F"); // darkness outside the reveal stays under fog
  });

  test("FR-FOG-20 DM darkness: hatched (translucent fill + hairlines), offset by a drag", () => {
    const r = new Raster(100, 60);
    paintDarknessDm(r, { rect: [1, 1, 3, 3] }, map, { color: "D", alpha: 0.35 }, 1, 2, 0);
    expect(cell(r, 3, 1)).toEqual({ label: "D", alpha: 0.35 });
    expect(label(r, 1, 1)).toBeNull();
    expect(r.strokes).toBe(1);
  });

  test("FOG §7 fog-mask attrs: shapes, darkness, fogged / explored cells of the map box", () => {
    expect(fogStats(null, map)).toEqual({ shapes: 0, darkness: 0, fogged: 0, explored: 0 });
    const s = fogStats({ ...fogged, shapes, darkness: [{ id: "d", circle: [1, 1, 1] }] }, map);
    // 60 cells: reveal 6 × 6 = 36 (centres x, y ≤ 6), explored 3 × 3 = 9, fog circle r 0.75 at
    // (2, 2) holds centres (1.5, 1.5), (2.5, 1.5), (1.5, 2.5), (2.5, 2.5) (d 0.707).
    expect(s).toEqual({ shapes: 3, darkness: 1, fogged: 24 + 4, explored: 9 - 4 });
  });

  test("FOG §7 fog-vision / fog-explored markers: the player's own rows only", () => {
    const m = new Uint8Array(6).fill(0);
    m[1] = 1;
    m[4] = 1;
    const records = {
      vision: {
        "s:p1": {
          id: "s:p1",
          sceneId: "s",
          playerId: "p1",
          blind: false,
          see: [[0, 0, 1, 0, 1, 1]],
          dark: [],
        },
        "s:p2": { id: "s:p2", sceneId: "s", playerId: "p2", blind: true, see: [], dark: [] },
      },
      "fog-explored": {
        "s:p1": {
          id: "s:p1",
          sceneId: "s",
          playerId: "p1",
          box: [0, 0, 3, 2],
          runs: encodeRuns(m, "clear"),
        },
      },
    };
    expect(ownFogRows(records, "s", "p1")).toEqual({
      vision: { sources: 1, blind: false, see: [[0, 0, 1, 0, 1, 1]], dark: [] },
      explored: { cells: 2 },
    });
    expect(ownFogRows(records, "s", "p2")).toEqual({
      vision: { sources: 0, blind: true, see: [], dark: [] },
      explored: null,
    });
    expect(ownFogRows(records, "s", null)).toEqual({ vision: null, explored: null });
  });
});
