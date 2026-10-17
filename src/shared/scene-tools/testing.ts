// Test references for scene-tools geometry; no product code imports this file.
import type { Cell } from "./geometry";
import { FT_PER_CELL, TEMPLATE_WIDTH, type TemplateGeometry } from "./schemas";

const EPS = 1e-9;
const norm360 = (a: number) => ((a % 360) + 360) % 360;

/**
 * Sprint 2's FR-SCN-21 rule, superseded by FR-SCN-41 in sprint 4: the (uncut) cells whose centre
 * lies inside or on a snapped template (integer origin, 15° steps). The reference FR-SCN-42's
 * `centre` mode is checked against. Row-major order.
 */
export function sprint2TemplateCells(t: TemplateGeometry): Cell[] {
  const L = t.size / FT_PER_CELL;
  const out: Cell[] = [];
  if (t.shape === "sphere" || t.shape === "cylinder") {
    // Doubled coordinates: centre (2c + 1, 2r + 1), origin (2x, 2y); exact.
    const r2 = (2 * L) ** 2;
    for (let r = t.y - L; r < t.y + L; r++)
      for (let c = t.x - L; c < t.x + L; c++) {
        const dx = 2 * c + 1 - 2 * t.x;
        const dy = 2 * r + 1 - 2 * t.y;
        if (dx * dx + dy * dy <= r2) out.push([c, r]);
      }
    return out;
  }
  if (t.shape === "cube") {
    // The origin is a corner; `angle` picks the quadrant (0 SE, 90 SW, 180 NW, 270 NE).
    const q = Math.floor(norm360(t.angle) / 90);
    const c0 = q === 0 || q === 3 ? t.x : t.x - L;
    const r0 = q === 0 || q === 1 ? t.y : t.y - L;
    for (let r = r0; r < r0 + L; r++) for (let c = c0; c < c0 + L; c++) out.push([c, r]);
    return out;
  }
  // Cone (width at distance d = d) and line (width `width`), along `angle` from the origin.
  const rad = (norm360(t.angle) * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const half = t.shape === "line" ? (t.width ?? TEMPLATE_WIDTH.default) / FT_PER_CELL / 2 : 0;
  const reach = Math.ceil(L + half) + 1;
  for (let r = t.y - reach; r < t.y + reach; r++)
    for (let c = t.x - reach; c < t.x + reach; c++) {
      const dx = c + 0.5 - t.x;
      const dy = r + 0.5 - t.y;
      const along = dx * ux + dy * uy;
      const across = Math.abs(dx * uy - dy * ux);
      if (along < -EPS || along > L + EPS) continue;
      const limit = t.shape === "cone" ? along / 2 : half;
      if (across <= limit + EPS) out.push([c, r]);
    }
  return out;
}
