// Player view (FR-FOG-21, V3): the static fog (`render.ts` `paintFog`, with the player's explored
// memory) and then, from the server's `vision` record (never a client recompute), sight on top:
// 1. darkvision ring (inside a `dark` polygon): what is not statically clear draws dimmed +
//    desaturated (`fog.darkvision`), so the static painter runs again there with that paint;
// 2. inside a `see` polygon: clear;
// 3. darkness inside any polygon: a darker, more transparent tint (`fog.darkness-seen`). Only a
//    source that sees through magical darkness has darkness inside its polygon (the others' are
//    cut at its edges, FR-FOG-33), so "in a polygon and in darkness" = seen through.
// Blind (FR-FOG-36): the whole map dark (`fog.darkness`) with the grid lines redrawn on top.
// Polygons are wound one way before they are clipped as a union (nonzero). DOM-free.
import { exploredMask } from "@shared/fog-of-war/explored";
import type { FogBox } from "@shared/fog-of-war/schemas";
import type { MapRect } from "@shared/scenes-map/geometry";
import {
  FOG_COLOR_FALLBACK,
  type FogPaints,
  type FogRecordLike,
  type FogRun,
  type GridPx,
  type Paint,
  type PaintCtx,
  paintFog,
  shapePath,
} from "./render";

/** The fields of a `vision` record the view reads. */
export interface VisionLike {
  blind: boolean;
  see: readonly (readonly number[])[];
  dark: readonly (readonly number[])[];
}

export interface ViewPaints extends FogPaints {
  darkvision: Paint;
  darknessSeen: Paint;
}

/** FOG §7 placeholder tokens (OQ-FOG-17) of the two vision paints. */
export const VISION_COLOR_VARS = {
  darkvision: "--fog-darkvision",
  darknessSeen: "--fog-darkness-seen",
} as const;
export const DARKVISION_FALLBACK = "#52525b";
export const DARKNESS_SEEN_FALLBACK = "#1e1033";
/** Darkvision dims + greys the map; seen-through darkness: darker, more transparent than Explored. */
export const VISION_ALPHA = { darkvision: 0.5, darknessSeen: 0.45 } as const;
/** FR-FOG-20: View as P draws P's render at 70 % over the DM view. */
export const VIEW_AS_OPACITY = 0.7;

/** Grid lines redrawn over the blind screen (the grid layer is under the fog layer). */
export interface GridLines {
  visible: boolean;
  color: string;
  opacity: number;
  /** Line width in map px (1 screen px). */
  width: number;
}

/** FR-FOG-37: a `fog-explored` row's cells as row runs in map px (the memory the view draws). */
export function memoryRuns(row: { box: FogBox; runs: string } | null, g: GridPx): FogRun[] {
  if (row === null) return [];
  const mask = exploredMask(row);
  const [col0, row0, cols, rows] = mask.box;
  const cs = g.gridCellSize;
  const out: FogRun[] = [];
  for (let r = 0; r < rows; r++) {
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && mask.cells[r * cols + c] === 1;
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        out.push([
          g.gridOffsetX + (col0 + start) * cs,
          g.gridOffsetY + (row0 + r) * cs,
          (c - start) * cs,
          cs,
        ]);
        start = -1;
      }
    }
  }
  return out;
}

/** Signed area of a flat polygon (any consistent unit). */
function signedArea(flat: readonly number[]): number {
  let a = 0;
  const n = flat.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a +=
      (flat[2 * j] as number) * (flat[2 * i + 1] as number) -
      (flat[2 * i] as number) * (flat[2 * j + 1] as number);
  }
  return a / 2;
}

/** Adds a sight polygon (grid units → map px), always wound the same way (nonzero union). */
export function polygonPath(ctx: PaintCtx, flat: readonly number[], g: GridPx): void {
  const n = flat.length >> 1;
  if (n < 3) return;
  const cs = g.gridCellSize;
  const ccw = signedArea(flat) >= 0;
  for (let k = 0; k < n; k++) {
    const i = ccw ? k : n - 1 - k;
    const x = g.gridOffsetX + (flat[2 * i] as number) * cs;
    const y = g.gridOffsetY + (flat[2 * i + 1] as number) * cs;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function withClip(ctx: PaintCtx, clip: () => void, draw: () => void) {
  ctx.save();
  ctx.beginPath();
  clip();
  ctx.clip("nonzero");
  draw();
  ctx.restore();
}

function eraseAll(ctx: PaintCtx, m: MapRect) {
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fillStyle = FOG_COLOR_FALLBACK;
  ctx.beginPath();
  ctx.rect(0, 0, m.mapWidth, m.mapHeight);
  ctx.fill();
}

/** FR-FOG-36: the dark screen, grid lines on top (same lines as the grid layer). */
export function paintBlind(ctx: PaintCtx, m: MapRect, paint: Paint, grid?: GridLines): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = paint.alpha;
  ctx.fillStyle = paint.color;
  ctx.beginPath();
  ctx.rect(0, 0, m.mapWidth, m.mapHeight);
  ctx.fill();
  if (grid?.visible) {
    const cell = m.gridCellSize;
    ctx.globalAlpha = grid.opacity;
    ctx.strokeStyle = grid.color;
    ctx.lineWidth = grid.width;
    ctx.beginPath();
    for (let x = m.gridOffsetX; x <= m.mapWidth; x += cell) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, m.mapHeight);
    }
    for (let y = m.gridOffsetY; y <= m.mapHeight; y += cell) {
      ctx.moveTo(0, y);
      ctx.lineTo(m.mapWidth, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export interface ViewInput {
  /** The viewer's `fog` record (players: redacted, darkness filtered, FR-FOG-44). */
  fog: FogRecordLike & { explored?: boolean };
  /** The viewer's `fog-explored` row as map px runs (`memoryRuns`); drawn only while `explored`. */
  memory: readonly FogRun[];
  /** The viewer's `vision` record; null = no source on the scene (static fog only). */
  vision: VisionLike | null;
}

/** FR-FOG-21: one player's view of a scene, painter order (see the header). */
export function paintPlayerView(
  ctx: PaintCtx,
  input: ViewInput,
  m: MapRect,
  paints: ViewPaints,
  grid?: GridLines,
): void {
  const { fog, vision } = input;
  if (vision?.blind) {
    paintBlind(ctx, m, paints.darkness, grid);
    return;
  }
  const memory = fog.explored === true ? input.memory : [];
  paintFog(ctx, fog, m, "player", paints, 0, memory);
  if (!vision || (vision.see.length === 0 && vision.dark.length === 0)) return;
  const tint: FogPaints = {
    fog: paints.darkvision,
    explored: paints.darkvision,
    darkness: paints.darkvision,
  };
  if (vision.dark.length > 0) {
    withClip(
      ctx,
      () => {
        for (const p of vision.dark) polygonPath(ctx, p, m);
      },
      () => {
        eraseAll(ctx, m);
        paintFog(ctx, { ...fog, darkness: [] }, m, "player", tint, 0, memory);
      },
    );
  }
  if (vision.see.length > 0) {
    withClip(
      ctx,
      () => {
        for (const p of vision.see) polygonPath(ctx, p, m);
      },
      () => eraseAll(ctx, m),
    );
  }
  const darkness = fog.darkness ?? [];
  if (darkness.length === 0) return;
  withClip(
    ctx,
    () => {
      for (const p of [...vision.see, ...vision.dark]) polygonPath(ctx, p, m);
    },
    () => {
      for (const d of darkness) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.globalAlpha = 1;
        ctx.beginPath();
        shapePath(ctx, d, m);
        ctx.fill("evenodd");
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = paints.darknessSeen.alpha;
        ctx.fillStyle = paints.darknessSeen.color;
        ctx.beginPath();
        shapePath(ctx, d, m);
        ctx.fill("evenodd");
      }
    },
  );
}
