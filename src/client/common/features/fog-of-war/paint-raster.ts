// Test-only software rasteriser standing in for the canvas (`PaintCtx`): pixel centres,
// source-over / destination-out, nested clips, nonzero (≈ "inside any subpath", for subpaths wound
// one way) and even-odd fill rules. A pixel keeps the label and alpha of the last paint on it (no
// blending), so tests read what a pixel ends up showing. Used by `paint.test.ts`, `vision.test.ts`.
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
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const cx = x;
        const cy = y;
        if (!inside(subs, cx, cy, rule)) continue;
        if (!(this.clips.at(-1) ?? []).every((c) => inside(c.subs, cx, cy, c.rule))) continue;
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
      if (c) n++;
    }
  }
  return rule === "evenodd" ? n % 2 === 1 : n > 0;
}
