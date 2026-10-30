// Test-only software rasteriser standing in for the canvas (`PaintCtx`): pixel centres,
// source-over / lighter / destination-out / source-in / source-atop, nested clips, nonzero
// (a polygon counts by its winding: a hole wound against its outline cuts it) and even-odd fill
// rules. A pixel keeps the
// label and alpha of the last paint on it (no blending), so tests read what a pixel ends up
// showing; `drawImage` paints the label `img:<image>` and a later `source-atop` paint keeps it as
// `img` (what lies under the tint). `EdgePixel`: the antialiased edge the raster can't show. Used
// by `paint.test.ts`, `vision.test.ts`.
import type { PaintCtx } from "./render";

type Rule = "nonzero" | "evenodd";
interface Clip {
  subs: Sub[];
  rule: Rule;
}

type Sub =
  | { k: "rect"; x: number; y: number; w: number; h: number }
  | { k: "arc"; x: number; y: number; r: number }
  | { k: "poly"; pts: [number, number][] };

/** One pixel: the paint label on top and its alpha (null = transparent). */
export interface Px {
  label: string | null;
  alpha: number;
  /** The image under a `source-atop` paint (set only then). */
  img?: string;
}

/** A W × H raster that runs `PaintCtx` calls; pixel (x, y) is covered iff the point (x, y) is. */
export class Raster implements PaintCtx {
  globalCompositeOperation = "source-over";
  globalAlpha = 1;
  fillStyle: unknown = "#000";
  strokeStyle: unknown = "#000";
  lineWidth = 1;
  px: Px[];
  strokes = 0;
  /** Style and alpha of each `stroke()` call. */
  strokeLog: { style: unknown; alpha: number }[] = [];
  private path: Sub[] = [];
  private clips: Clip[][] = [[]];
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
    this.strokeLog.push({ style: this.strokeStyle, alpha: this.globalAlpha });
  }
  clip(rule: Rule = "nonzero") {
    (this.clips.at(-1) as Clip[]).push({
      subs: this.path.filter((s) => s.k !== "poly" || s.pts.length > 2),
      rule,
    });
  }
  fill(rule: Rule = "nonzero") {
    const subs = this.path.filter((s) => s.k !== "poly" || s.pts.length > 2);
    this.paint((x, y) => inside(subs, x, y, rule), String(this.fillStyle));
  }
  drawImage(image: unknown, x: number, y: number, w: number, h: number) {
    const r: Sub[] = [{ k: "rect", x, y, w, h }];
    this.paint((px, py) => inside(r, px, py, "nonzero"), `img:${String(image)}`);
  }
  private paint(covers: (x: number, y: number) => boolean, label: string) {
    const gco = this.globalCompositeOperation;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!(this.clips.at(-1) ?? []).every((c) => inside(c.subs, x, y, c.rule))) continue;
        const p = this.px[y * this.w + x] as Px;
        const hit = covers(x, y);
        // source-in clears the destination outside the source too (within the clip).
        if (gco === "source-in") {
          if (hit && p.label !== null) {
            p.label = label;
            p.alpha = this.globalAlpha;
          } else {
            p.label = null;
            p.alpha = 0;
          }
          continue;
        }
        if (!hit) continue;
        if (gco === "destination-out") {
          p.label = null;
          p.alpha = 0;
        } else if (gco === "source-atop") {
          if (p.label === null) continue;
          if (p.label.startsWith("img:")) p.img = p.label.slice(4);
          p.label = label;
          p.alpha = this.globalAlpha;
        } else {
          p.label = label;
          p.alpha = this.globalAlpha;
        }
      }
    }
  }
  at(x: number, y: number): Px {
    return this.px[Math.floor(y) * this.w + Math.floor(x)] as Px;
  }
}

/** Whole cells as an explored shape, one square piece per cell. */
export const cellSquares = (cells: readonly (readonly [number, number])[]): number[][][] =>
  cells.map(([c, r]) => [[c, r, c + 1, r, c + 1, r + 1, c, r + 1]]);

/**
 * One pixel on the edge of the circles painted over it, blended like a canvas: a path with an arc
 * covers it by `coverage`, any other wholly. It lies inside or outside the explored shapes, which is
 * what a clip of those shapes (nonzero) or of the map + a shape (even-odd) tests.
 */
export class EdgePixel implements PaintCtx {
  globalCompositeOperation = "source-over";
  globalAlpha = 1;
  fillStyle: unknown = "#000";
  strokeStyle: unknown = "#000";
  lineWidth = 1;
  alpha = 0;
  private hasArc = false;
  private clipped = 1;
  private stack: { gco: string; alpha: number; clipped: number }[] = [];
  constructor(
    readonly coverage: number,
    readonly inMemory = false,
  ) {}
  save() {
    this.stack.push({
      gco: this.globalCompositeOperation,
      alpha: this.globalAlpha,
      clipped: this.clipped,
    });
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    this.globalCompositeOperation = s.gco;
    this.globalAlpha = s.alpha;
    this.clipped = s.clipped;
  }
  beginPath() {
    this.hasArc = false;
  }
  rect() {}
  arc() {
    this.hasArc = true;
  }
  moveTo() {}
  lineTo() {}
  closePath() {}
  stroke() {}
  clip(rule: Rule = "nonzero") {
    if (this.hasArc) this.clipped *= this.coverage;
    else if (rule === "evenodd") this.clipped *= this.inMemory ? 0 : 1;
    else this.clipped *= this.inMemory ? 1 : 0;
  }
  fill() {
    const c = (this.hasArc ? this.coverage : 1) * this.clipped;
    const src = this.globalAlpha * c;
    const a = this.alpha;
    if (this.globalCompositeOperation === "destination-out") this.alpha = a * (1 - c);
    else if (this.globalCompositeOperation === "lighter") this.alpha = Math.min(1, a + src);
    else this.alpha = a + src - a * src;
  }
}

/** Fill rule over the subpaths (each rect / circle / polygon its own subpath). */
function inside(subs: Sub[], x: number, y: number, rule: Rule): boolean {
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
      if (c) n += rule === "nonzero" && winding(s.pts) < 0 ? -1 : 1;
    }
  }
  return rule === "evenodd" ? n % 2 === 1 : n !== 0;
}

function winding(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i] as [number, number];
    const [xj, yj] = pts[j] as [number, number];
    a += xj * yi - xi * yj;
  }
  return a;
}
