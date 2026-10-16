// FOG §13 client unit rows: FR-FOG-20/21 painter (V1, static). A tiny software rasteriser stands in
// for the canvas (pixel centres, source-over / destination-out, clip), so the tests read what a
// pixel ends up showing: painter order over the base mask, DM alphas, player darkness only where
// statically clear (never over Fog or Explored), the `fog-mask` attrs, DM darkness hatching.
import { describe, expect, test } from "bun:test";
import type { DarknessShape, FogLayerShape } from "@shared/fog-of-war/shapes";
import {
  FOG_ALPHA,
  type FogPaints,
  fogStats,
  type PaintCtx,
  paintDarknessDm,
  paintFog,
} from "./render";

type Sub =
  | { k: "rect"; x: number; y: number; w: number; h: number }
  | { k: "arc"; x: number; y: number; r: number }
  | { k: "poly"; pts: [number, number][] };

/** One pixel: the paint label on top and its alpha (null = transparent). */
interface Px {
  label: string | null;
  alpha: number;
}

/** A W × H raster that runs `PaintCtx` calls; pixel (x, y) is covered iff the point (x, y) is. */
class Raster implements PaintCtx {
  globalCompositeOperation = "source-over";
  globalAlpha = 1;
  fillStyle: unknown = "#000";
  strokeStyle: unknown = "#000";
  lineWidth = 1;
  px: Px[];
  strokes = 0;
  private path: Sub[] = [];
  private clips: Sub[][][] = [[]];
  private stack: { gco: string; alpha: number; clips: number }[] = [];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = Array.from({ length: w * h }, () => ({ label: null, alpha: 0 }));
  }
  save() {
    this.stack.push({
      gco: this.globalCompositeOperation,
      alpha: this.globalAlpha,
      clips: this.clips.length,
    });
    this.clips.push([...(this.clips.at(-1) ?? [])]);
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    this.globalCompositeOperation = s.gco;
    this.globalAlpha = s.alpha;
    this.clips.length = s.clips;
  }
  beginPath() {
    this.path = [];
  }
  rect(x: number, y: number, w: number, h: number) {
    this.path.push({ k: "rect", x, y, w, h });
  }
  arc(x: number, y: number, r: number) {
    this.path.push({ k: "arc", x, y, r });
  }
  moveTo(x: number, y: number) {
    this.path.push({ k: "poly", pts: [[x, y]] });
  }
  lineTo(x: number, y: number) {
    const last = this.path.at(-1);
    if (last?.k === "poly") last.pts.push([x, y]);
  }
  closePath() {}
  stroke() {
    this.strokes++;
  }
  clip() {
    (this.clips.at(-1) as Sub[][]).push(
      this.path.filter((s) => s.k !== "poly" || s.pts.length > 2),
    );
  }
  fill() {
    const subs = this.path.filter((s) => s.k !== "poly" || s.pts.length > 2);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const cx = x;
        const cy = y;
        if (!inside(subs, cx, cy)) continue;
        if (!(this.clips.at(-1) ?? []).every((c) => inside(c, cx, cy))) continue;
        const p = this.px[y * this.w + x] as Px;
        if (this.globalCompositeOperation === "destination-out") {
          p.label = null;
          p.alpha = 0;
        } else {
          p.label = String(this.fillStyle);
          p.alpha = this.globalAlpha;
        }
      }
    }
  }
  at(x: number, y: number): Px {
    return this.px[Math.floor(y) * this.w + Math.floor(x)] as Px;
  }
}

/** Even-odd over the subpaths (each rect / circle / polygon its own subpath). */
function inside(subs: Sub[], x: number, y: number): boolean {
  let n = 0;
  for (const s of subs) {
    if (s.k === "rect" && x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) n++;
    if (s.k === "arc" && (x - s.x) ** 2 + (y - s.y) ** 2 <= s.r ** 2) n++;
    if (s.k === "poly") {
      let c = false;
      for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
        const [xi, yi] = s.pts[i] as [number, number];
        const [xj, yj] = s.pts[j] as [number, number];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      if (c) n++;
    }
  }
  return n % 2 === 1;
}

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
});
