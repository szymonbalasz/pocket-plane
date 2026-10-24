// Map cell helpers (FR-MAP-44 BL-01, OQ-MAP-46): Fit frames the map edge to edge, so a fixed cell
// may sit under a window (the Game log). `mapPoint` returns a cell centre on screen and, while a
// window covers it, pans the map with a middle-mouse drag (FR-MAP-12) until it is clear.
import type { Page } from "@playwright/test";

export interface GridSpec {
  /** Map px per cell and the grid offset (the e2e scenes: 70 px, no offset). */
  cell: number;
  offsetX: number;
  offsetY: number;
}

const GRID_70: GridSpec = { cell: 70, offsetX: 0, offsetY: 0 };

/** Page px of grid point (gx, gy) in cells (corner (i, j) = (i, j); centre = (c + 0.5, r + 0.5)). */
export async function gridPoint(page: Page, gx: number, gy: number, grid: GridSpec = GRID_70) {
  return page.evaluate(
    ([gx, gy, g]) => {
      type KStage = { container(): HTMLElement; x(): number; y(): number; scaleX(): number };
      const st = (window as unknown as { Konva: { stages: KStage[] } }).Konva.stages[0] as KStage;
      const box = st.container().getBoundingClientRect();
      const s = st.scaleX();
      return {
        x: box.left + st.x() + (g.offsetX + gx * g.cell) * s,
        y: box.top + st.y() + (g.offsetY + gy * g.cell) * s,
      };
    },
    [gx, gy, grid] as const,
  );
}

/**
 * Whether the cell at page point `p` (and `margin` cells around it, on-screen cell `px`) is on the
 * map canvas with nothing over it; otherwise the nearest clear point (24 px raster) or null.
 */
function clearOrNearest(page: Page, p: { x: number; y: number }, margin: number) {
  return page.evaluate(
    ([p, margin]) => {
      const canvas = document.querySelector('[data-testid="map-canvas"]');
      if (!canvas) return { clear: false, near: null };
      const r = canvas.getBoundingClientRect();
      const px = Number(canvas.getAttribute("data-cell-px") ?? "48");
      const free = (x: number, y: number) => {
        if (x < r.left + 2 || y < r.top + 2 || x > r.right - 2 || y > r.bottom - 2) return false;
        if (x > window.innerWidth - 2 || y > window.innerHeight - 2) return false;
        const el = document.elementFromPoint(x, y);
        return el !== null && el.tagName === "CANVAS" && canvas.contains(el);
      };
      const clearAt = (x: number, y: number) => {
        for (const dx of [-margin, 0, margin])
          for (const dy of [-margin, 0, margin]) if (!free(x + dx * px, y + dy * px)) return false;
        return true;
      };
      if (clearAt(p.x, p.y)) return { clear: true, near: null };
      let near: { x: number; y: number } | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (let x = r.left + 12; x < r.right; x += 24)
        for (let y = r.top + 12; y < r.bottom; y += 24) {
          const d = (x - p.x) ** 2 + (y - p.y) ** 2;
          if (d < best && clearAt(x, y)) {
            best = d;
            near = { x, y };
          }
        }
      return { clear: false, near };
    },
    [p, margin] as const,
  );
}

const stageAt = (page: Page) =>
  page.evaluate(() => {
    const st = (window as unknown as { Konva: { stages: { x(): number; y(): number }[] } }).Konva
      .stages[0];
    return { x: st?.x() ?? 0, y: st?.y() ?? 0 };
  });

/**
 * The centre (page px) of cell (col, row), clear of every window together with `margin` cells
 * around it (default 1): while it is covered, a middle-mouse drag pans the map so the cell lands
 * on the nearest clear spot. Leaves `data-camera="moved"` when it had to pan.
 */
export async function mapPoint(
  page: Page,
  col: number,
  row: number,
  opts: { margin?: number; grid?: GridSpec } = {},
): Promise<{ x: number; y: number }> {
  const margin = opts.margin ?? 1;
  const grid = opts.grid ?? GRID_70;
  for (let i = 0; i < 6; i++) {
    const p = await gridPoint(page, col + 0.5, row + 0.5, grid);
    const { clear, near } = await clearOrNearest(page, p, margin);
    if (clear) return p;
    if (!near) throw new Error(`mapPoint: no clear spot for cell (${col}, ${row})`);
    // Press on the clear spot (always on the canvas) and move by the way the cell must go; the
    // release may land anywhere in the viewport (the pan follows window events).
    const vp = page.viewportSize() ?? { width: 1280, height: 800 };
    const to = {
      x: Math.min(vp.width - 2, Math.max(2, near.x + (near.x - p.x))),
      y: Math.min(vp.height - 2, Math.max(2, near.y + (near.y - p.y))),
    };
    const before = await stageAt(page);
    await page.mouse.move(near.x, near.y);
    await page.mouse.down({ button: "middle" });
    for (let k = 1; k <= 4; k++)
      await page.mouse.move(near.x + ((to.x - near.x) * k) / 4, near.y + ((to.y - near.y) * k) / 4);
    await page.mouse.up({ button: "middle" });
    await page.waitForFunction((b) => {
      const st = (window as unknown as { Konva: { stages: { x(): number; y(): number }[] } }).Konva
        .stages[0];
      return st !== undefined && (st.x() !== b.x || st.y() !== b.y);
    }, before);
  }
  throw new Error(`mapPoint: cell (${col}, ${row}) still covered after 6 pans`);
}

/** Pans the map by (dx, dy) screen px with a middle-mouse drag from the canvas centre (FR-MAP-12). */
export async function panMap(page: Page, dx: number, dy: number) {
  const r = await page.getByTestId("map-canvas").boundingBox();
  if (!r) throw new Error("panMap: no map canvas");
  const start = await clearOrNearest(page, { x: r.x + r.width / 2, y: r.y + r.height / 2 }, 0);
  const s = start.clear ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : start.near;
  if (!s) throw new Error("panMap: no clear spot on the map");
  const before = await stageAt(page);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down({ button: "middle" });
  for (let k = 1; k <= 4; k++) await page.mouse.move(s.x + (dx * k) / 4, s.y + (dy * k) / 4);
  await page.mouse.up({ button: "middle" });
  const after = await stageAt(page);
  if (after.x === before.x && after.y === before.y) throw new Error("panMap: the map didn't move");
}
