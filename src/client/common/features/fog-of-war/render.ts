// Fog render (FR-FOG-20/21), static (V1): the base mask (re-based to the scene's current box:
// cells keep their index, cells outside the stored box take `fill`) painted, then every fog shape
// in list order over it (painter: each shape first erases what is under it, then paints its own
// state), all inside one Konva shape on the fog layer.
// - DM: Fog ≈ 50 %, Explored ≈ 25 %, shape edges hairline; darkness is drawn by its own hatched
//   nodes on top.
// - Player: Fog opaque, Explored dims the map; darkness draws opaque only where the point is
//   statically clear (never over Fog or Explored): painted first, erased under base fog and under
//   each fog / explored shape, re-painted inside each reveal shape; explored memory turns Fog
//   into Explored (V3). Sight, darkvision and the blind screen go on top: `vision-render.ts`.
// Sprint 4 (FR-FOG-26): the brush's `cells` (one rect per painted cell) and `stroke` (a circle per
// point + a quad per segment, wound one way) shapes fill with the nonzero rule (a union); the
// others keep even-odd. The brush tool itself is V9.
// DOM-free (a minimal 2D-context interface) so it runs under `bun test`.

import { decodeCells } from "@shared/fog-of-war/brush";
import { exploredMask } from "@shared/fog-of-war/explored";
import { type FogRow, fogBox, maskOf, rebase } from "@shared/fog-of-war/mask";
import {
  FOG_EXPLORED_TYPE,
  type FogBox,
  type FogExploredRecord,
  type FogFill,
  scenePlayerId,
  VISION_TYPE,
  type VisionRecord,
} from "@shared/fog-of-war/schemas";
import {
  type DarknessShape,
  type FogLayerShape,
  isBrush,
  type LayerShapeLike,
  type ShapeLike,
} from "@shared/fog-of-war/shapes";
import { prepareStaticLayer, samplePoint } from "@shared/fog-of-war/vision";
import type { MapRect } from "@shared/scenes-map/geometry";
import type { CanvasClient } from "../scenes-map/layers";

/** One horizontal run of fogged cells, in map px: `[x, y, w, h]`. */
export type FogRun = readonly [number, number, number, number];

export interface FogRender {
  runs: FogRun[];
  /** Fogged base cells drawn. */
  cells: number;
}

/** The fields of a `fog` record the render reads (DM and player shapes both carry them). */
export interface FogRecordLike {
  fill: FogFill;
  box: FogBox;
  runs: string;
  shapes?: readonly FogLayerShape[];
  darkness?: readonly DarknessShape[];
}

/**
 * FR-FOG-20/21: fogged **base** cells of the map's current box as row runs. No record = no fog
 * (FR-FOG-01); a corrupt `runs` draws fully fogged (fail closed, FR-FOG-04).
 */
export function fogRuns(rec: FogRecordLike | null, m: MapRect): FogRender {
  if (rec === null) return { runs: [], cells: 0 };
  const row: FogRow = { fill: rec.fill, box: rec.box, runs: rec.runs };
  const box = fogBox(m);
  const mask = rebase(maskOf(row).mask, box);
  const [col0, row0, cols, rows] = box;
  const cs = m.gridCellSize;
  const runs: FogRun[] = [];
  let cells = 0;
  for (let r = 0; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && mask.cells[r * cols + c] === 1;
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        runs.push([
          m.gridOffsetX + (col0 + start) * cs,
          m.gridOffsetY + (row0 + r) * cs,
          (c - start) * cs,
          cs,
        ]);
        cells += c - start;
        start = -1;
      }
    }
  }
  return { runs, cells };
}

/** Konva attrs of `fog-mask` (FOG §7): counts a walkthrough can assert on. */
export interface FogStats {
  shapes: number;
  darkness: number;
  /** Cells of the map box whose centre is statically fogged / explored (FR-FOG-01). */
  fogged: number;
  explored: number;
}

export function fogStats(rec: FogRecordLike | null, m: MapRect): FogStats {
  if (rec === null) return { shapes: 0, darkness: 0, fogged: 0, explored: 0 };
  const box = fogBox(m);
  const mask = rebase(maskOf({ fill: rec.fill, box: rec.box, runs: rec.runs }).mask, box);
  const layer = prepareStaticLayer(mask, rec.shapes ?? [], []);
  const [col0, row0, cols, rows] = box;
  let fogged = 0;
  let explored = 0;
  for (let r = row0; r < row0 + rows; r++) {
    for (let c = col0; c < col0 + cols; c++) {
      const st = samplePoint(layer, c + 0.5, r + 0.5).state;
      if (st === "fog") fogged++;
      else if (st === "explored") explored++;
    }
  }
  return { shapes: rec.shapes?.length ?? 0, darkness: rec.darkness?.length ?? 0, fogged, explored };
}

/** The 2D-context calls the painter makes (a `CanvasRenderingContext2D` subset). */
export interface PaintCtx {
  globalCompositeOperation: string;
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(rule?: "nonzero" | "evenodd"): void;
  stroke(): void;
  clip(rule?: "nonzero" | "evenodd"): void;
  /** FR-FOG-21 (sprint 4): the darkvision ring's greyscale map copy. */
  drawImage?(image: CanvasImageSource, x: number, y: number, w: number, h: number): void;
}

/** Grid placement in map px. */
export interface GridPx {
  gridCellSize: number;
  gridOffsetX: number;
  gridOffsetY: number;
}

/** The fill rule a fog-layer shape's path needs: brush shapes are unions of subpaths. */
export const shapeRule = (s: LayerShapeLike): "nonzero" | "evenodd" =>
  isBrush(s) ? "nonzero" : "evenodd";

/** Adds a shape's outline (grid units → map px), offset by `(dx, dy)` grid units. */
export function shapePath(ctx: PaintCtx, s: LayerShapeLike, g: GridPx, dx = 0, dy = 0): void {
  const cs = g.gridCellSize;
  const X = (x: number) => g.gridOffsetX + (x + dx) * cs;
  const Y = (y: number) => g.gridOffsetY + (y + dy) * cs;
  if ("cells" in s) {
    const [col0, row0, cols] = s.cells.box;
    const cells = decodeCells(s.cells);
    cells?.forEach((v, i) => {
      if (v === 1) ctx.rect(X(col0 + (i % cols)), Y(row0 + Math.floor(i / cols)), cs, cs);
    });
    return;
  }
  if ("stroke" in s) {
    const [r = 0, ...xy] = s.stroke;
    const R = r * cs;
    for (let i = 0; i + 1 < xy.length; i += 2) {
      const x = X(xy[i] as number);
      const y = Y(xy[i + 1] as number);
      ctx.moveTo(x + R, y);
      ctx.arc(x, y, R, 0, 2 * Math.PI);
      if (i + 3 >= xy.length) continue;
      const x2 = X(xy[i + 2] as number);
      const y2 = Y(xy[i + 3] as number);
      const len = Math.hypot(x2 - x, y2 - y);
      if (len === 0) continue;
      // The quad wound like `arc` (increasing angle: +x towards +y).
      const nx = (-(y2 - y) / len) * R;
      const ny = ((x2 - x) / len) * R;
      ctx.moveTo(x - nx, y - ny);
      ctx.lineTo(x2 - nx, y2 - ny);
      ctx.lineTo(x2 + nx, y2 + ny);
      ctx.lineTo(x + nx, y + ny);
      ctx.closePath();
    }
    return;
  }
  if ("rect" in s) {
    const [a, b, c, d] = s.rect as [number, number, number, number];
    ctx.rect(X(Math.min(a, c)), Y(Math.min(b, d)), Math.abs(c - a) * cs, Math.abs(d - b) * cs);
    return;
  }
  if ("circle" in s) {
    const [cx, cy, r] = s.circle as [number, number, number];
    ctx.moveTo(X(cx) + r * cs, Y(cy));
    ctx.arc(X(cx), Y(cy), r * cs, 0, 2 * Math.PI);
    return;
  }
  const p = s.polygon;
  ctx.moveTo(X(p[0] as number), Y(p[1] as number));
  for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(X(p[i] as number), Y(p[i + 1] as number));
  ctx.closePath();
}

/** One paint: a colour and its alpha. */
export interface Paint {
  color: string;
  alpha: number;
}
export interface FogPaints {
  fog: Paint;
  explored: Paint;
  darkness: Paint;
}

/** FOG §7 placeholder tokens until theme-system names them (OQ-FOG-17). */
export const FOG_COLOR_VARS = {
  dm: { fog: "--fog-dm", explored: "--fog-dm-explored", darkness: "--fog-dm-darkness" },
  player: { fog: "--fog-player", explored: "--fog-explored", darkness: "--fog-darkness" },
} as const;
export const FOG_COLOR_FALLBACK = "#000000";
export const DM_DARKNESS_FALLBACK = "#3b0764";
/** FR-FOG-20 (OQ-FOG-19): the DM sees Fog at ≈ 50 %, Explored ≈ 25 %; players opaque Fog. */
export const FOG_DM_OPACITY = 0.5;
export const FOG_ALPHA: Record<CanvasClient, Record<keyof FogPaints, number>> = {
  dm: { fog: FOG_DM_OPACITY, explored: 0.25, darkness: 0.35 },
  player: { fog: 1, explored: 0.6, darkness: 1 },
};

export function fogOpacity(client: CanvasClient): number {
  return FOG_ALPHA[client].fog;
}

function fillWith(ctx: PaintCtx, p: Paint, draw: () => void, rule?: "nonzero" | "evenodd") {
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  draw();
  ctx.fill(rule);
}

function erase(ctx: PaintCtx, draw: () => void, rule?: "nonzero" | "evenodd") {
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  draw();
  ctx.fill(rule);
}

/**
 * FR-FOG-37 (V3): inside `clip`, the player's explored-memory cells turn Fog into Explored (the
 * caller clips to where Fog was just painted).
 */
function fogToMemory(
  ctx: PaintCtx,
  paints: FogPaints,
  memory: readonly FogRun[],
  clip: () => void,
  rule?: "nonzero" | "evenodd",
) {
  if (memory.length === 0) return;
  const cells = () => {
    for (const [x, y, w, h] of memory) ctx.rect(x, y, w, h);
  };
  ctx.save();
  ctx.beginPath();
  clip();
  ctx.clip(rule);
  erase(ctx, cells);
  fillWith(ctx, paints.explored, cells);
  ctx.restore();
}

/**
 * FR-FOG-20/21: the static fog of one record, painter order (see the header). `memory` = the
 * player's explored-memory cells (map px runs, FR-FOG-37): Fog there draws as Explored.
 */
export function paintFog(
  ctx: PaintCtx,
  rec: FogRecordLike,
  m: MapRect,
  client: CanvasClient,
  paints: FogPaints,
  hairline = 0,
  memory: readonly FogRun[] = [],
): void {
  const base = fogRuns(rec, m).runs;
  const shapes = rec.shapes ?? [];
  const darkness = client === "player" ? (rec.darkness ?? []) : [];
  const darknessFill = () => {
    for (const d of darkness) fillWith(ctx, paints.darkness, () => shapePath(ctx, d, m));
  };
  const baseRuns = () => {
    for (const [x, y, w, h] of base) ctx.rect(x, y, w, h);
  };
  ctx.save();
  darknessFill();
  if (darkness.length > 0) erase(ctx, baseRuns);
  fillWith(ctx, paints.fog, baseRuns);
  if (base.length > 0) fogToMemory(ctx, paints, memory, baseRuns);
  for (const s of shapes as readonly FogLayerShape[]) {
    const path = () => shapePath(ctx, s, m);
    const rule = shapeRule(s);
    erase(ctx, path, rule);
    if (s.op === "fog") {
      fillWith(ctx, paints.fog, path, rule);
      fogToMemory(ctx, paints, memory, path, rule);
    } else if (s.op === "explored") fillWith(ctx, paints.explored, path, rule);
    else if (darkness.length > 0) {
      ctx.save();
      ctx.beginPath();
      path();
      ctx.clip(rule);
      darknessFill();
      ctx.restore();
    }
  }
  // FR-FOG-20: the DM sees every shape's edge as a hairline.
  if (client === "dm" && hairline > 0 && shapes.length > 0) {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = Math.min(1, paints.fog.alpha + 0.2);
    ctx.strokeStyle = paints.fog.color;
    ctx.lineWidth = hairline;
    ctx.beginPath();
    for (const s of shapes) shapePath(ctx, s, m);
    ctx.stroke();
  }
  ctx.restore();
}

/** Hatch spacing of DM darkness, in map px per cell (FR-FOG-20 `fog.dm-darkness`). */
const HATCH_PER_CELL = 4;

/**
 * FR-FOG-20: one darkness shape for the DM, hatched (translucent fill + diagonal lines), offset by
 * a drag in progress (grid units).
 */
export function paintDarknessDm(
  ctx: PaintCtx,
  d: ShapeLike,
  g: GridPx,
  paint: Paint,
  hairline: number,
  dx = 0,
  dy = 0,
): void {
  const cs = g.gridCellSize;
  ctx.save();
  fillWith(ctx, paint, () => shapePath(ctx, d, g, dx, dy), "evenodd");
  ctx.beginPath();
  shapePath(ctx, d, g, dx, dy);
  ctx.clip("evenodd");
  const b = boxPx(d, g, dx, dy);
  const step = cs / HATCH_PER_CELL;
  ctx.globalAlpha = Math.min(1, paint.alpha * 2);
  ctx.strokeStyle = paint.color;
  ctx.lineWidth = hairline;
  ctx.beginPath();
  const span = b[3] - b[1];
  for (let x = b[0] - span; x <= b[2]; x += step) {
    ctx.moveTo(x, b[3]);
    ctx.lineTo(x + span, b[1]);
  }
  ctx.stroke();
  ctx.restore();
}

/** A shape's bounding box in map px `[x0, y0, x1, y1]`. */
function boxPx(s: ShapeLike, g: GridPx, dx: number, dy: number): [number, number, number, number] {
  const cs = g.gridCellSize;
  const X = (x: number) => g.gridOffsetX + (x + dx) * cs;
  const Y = (y: number) => g.gridOffsetY + (y + dy) * cs;
  if ("rect" in s) {
    const [a, b, c, d] = s.rect as [number, number, number, number];
    return [X(Math.min(a, c)), Y(Math.min(b, d)), X(Math.max(a, c)), Y(Math.max(b, d))];
  }
  if ("circle" in s) {
    const [cx, cy, r] = s.circle as [number, number, number];
    return [X(cx - r), Y(cy - r), X(cx + r), Y(cy + r)];
  }
  const xs = s.polygon.filter((_, i) => i % 2 === 0);
  const ys = s.polygon.filter((_, i) => i % 2 === 1);
  return [X(Math.min(...xs)), Y(Math.min(...ys)), X(Math.max(...xs)), Y(Math.max(...ys))];
}

/**
 * FOG §7 marker attrs from the viewer's own rows on a scene (players: their `vision` and
 * `fog-explored`, written from V2 on): `fog-vision` `{sources, blind, see, dark}` (the record's
 * flat polygons; `sources` = polygons per kind, at most one each per source) and `fog-explored`
 * `{cells}`. Null when the row is absent.
 */
export function ownFogRows(
  records: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  sceneId: string,
  playerId: string | null,
): {
  vision: { sources: number; blind: boolean; see: number[][]; dark: number[][] } | null;
  explored: { cells: number } | null;
} {
  if (playerId === null) return { vision: null, explored: null };
  const id = scenePlayerId(sceneId, playerId);
  const v = records[VISION_TYPE]?.[id] as VisionRecord | undefined;
  const e = records[FOG_EXPLORED_TYPE]?.[id] as FogExploredRecord | undefined;
  return {
    vision: v
      ? {
          sources: Math.max(v.see.length, v.dark.length),
          blind: v.blind,
          see: v.see,
          dark: v.dark,
        }
      : null,
    explored: e ? { cells: exploredMask(e).cells.reduce((n, c) => n + c, 0) } : null,
  };
}
