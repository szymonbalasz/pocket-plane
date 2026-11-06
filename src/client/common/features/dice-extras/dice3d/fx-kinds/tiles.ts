// FR-DICEX-106: the particle sprite atlas. Core tiles (any kind may use them) plus the tiles of
// the kinds in a throw, one cell each in a square grid (a power of two per side, 128 px cells);
// one name = one cell, the first kind's drawing wins.
import type { TileDraw } from "./kind";

export const TILE_PX = 128;

/** A soft white disc of radius `r` at x, y, alpha `a` at its centre. */
export function soft(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(255,255,255,${a})`);
  grad.addColorStop(0.4, `rgba(255,255,255,${a * 0.5})`);
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** A soft dot filling the cell. */
const dot: TileDraw = (g, px) => {
  const h = px / 2;
  soft(g, h, h, h, 1);
};

/** A sparkle: a four-point star on a soft core. */
const star: TileDraw = (g, px) => {
  const h = px / 2;
  soft(g, h, h, h * 0.45, 0.9);
  for (const [w, l] of [
    [0.09, 0.95],
    [0.05, 0.6],
  ] as const) {
    g.save();
    g.translate(h, h);
    if (l < 0.9) g.rotate(Math.PI / 4);
    for (const turn of [0, Math.PI / 2]) {
      g.save();
      g.rotate(turn);
      const grad = g.createLinearGradient(0, -h * l, 0, h * l);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.5, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(0, 0, h * w, h * l, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.restore();
  }
};

/** Sprites every kind may use by name. */
export const CORE_TILES: Readonly<Record<string, TileDraw>> = { dot, star };

export interface AtlasLayout {
  /** Cells per side. */
  grid: number;
  /** Each name's cell, row by row. */
  index: ReadonlyMap<string, number>;
  draws: readonly TileDraw[];
}

/** The atlas for the core tiles plus these sets (in order; a repeated name keeps its first). */
export function atlasLayout(sets: readonly Readonly<Record<string, TileDraw>>[]): AtlasLayout {
  const index = new Map<string, number>();
  const draws: TileDraw[] = [];
  for (const set of [CORE_TILES, ...sets]) {
    for (const [name, draw] of Object.entries(set)) {
      if (index.has(name)) continue;
      index.set(name, draws.length);
      draws.push(draw);
    }
  }
  let grid = 1;
  while (grid * grid < draws.length) grid *= 2;
  return { grid, index, draws };
}

/** The atlas canvas: each tile drawn in its cell, clipped to it. */
export function atlasCanvas(layout: AtlasLayout): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE_PX * layout.grid;
  c.height = TILE_PX * layout.grid;
  const g = c.getContext("2d");
  if (!g) return c;
  layout.draws.forEach((draw, i) => {
    g.save();
    g.translate((i % layout.grid) * TILE_PX, Math.floor(i / layout.grid) * TILE_PX);
    g.beginPath();
    g.rect(0, 0, TILE_PX, TILE_PX);
    g.clip();
    draw(g, TILE_PX);
    g.restore();
  });
  return c;
}
