// Black Tentacles renderer (FR-VFX-40, VFX §7.1): a template-anchored aura filling its cube's
// square (the frame's centre, side `size`, rotation `angle`). Under: an inky pool to the square's
// edge, edges breathing, a faint green-teal rim, oily bubbles rising and popping, and the
// tentacles' bodies: black, tapered, with a sheen and pale suckers, each rising out of the pool,
// writhing and sinking back on its own cycle (about two per three squares). Over: the same
// tentacles' upper halves, translucent, lapping over the tokens in the area. Strike (`turnInside`,
// a creature starting its turn inside): three tentacles rise around it and coil, a squeeze ring
// (1.2 s). Points are rotated by hand (no canvas transform), so a recording context sees them.
import type { FxParamsOut } from "@shared/spell-fx/presets";
import {
  type AuraFrame,
  type AuraInstance,
  type AuraReaction,
  type AuraRenderer,
  type DrawLevel,
  ease,
} from "../aura-types";
import { seededRandom } from "../prng";
import { dot } from "../sprites";

const TAU = Math.PI * 2;
const INK = "6, 6, 10";
const SHEEN = "95, 150, 155";
const RIM = "70, 140, 120";
const SUCKER = "175, 160, 195";

/** Tentacles at most (a 20 ft square draws about 11) and bubbles, per level. */
const TENTACLES = { full: 20, reduced: 8, still: 20 } as const;
const BUBBLES = { full: 12, reduced: 2, still: 12 } as const;
/** Tentacles per square of area. */
const PER_CELL = 0.7;
const SEG = 10;
const EDGE = 8;
const GRAB_S = 1.2;

interface Tentacle {
  /** Root in the square, −0.42…0.42 of its side. */
  rx: number;
  ry: number;
  dir: number;
  /** Length and base width in cells. */
  len: number;
  width: number;
  phase: number;
  period: number;
  curl: number;
}

interface Bubble {
  x: number;
  y: number;
  phase: number;
  period: number;
}

type Pt = readonly [number, number];

/** Radical inverse in base `b` (a Halton sequence: any prefix spreads over the square). */
function halton(i: number, b: number): number {
  let f = 1;
  let r = 0;
  let n = i;
  while (n > 0) {
    f /= b;
    r += f * (n % b);
    n = Math.floor(n / b);
  }
  return r;
}

const frac = (v: number) => v - Math.floor(v);

class BlackTentacles implements AuraInstance {
  private readonly tentacles: Tentacle[] = [];
  private readonly bubbles: Bubble[] = [];
  private readonly edge: number[] = [];
  private readonly grabAngle: number;

  constructor(seed: string, _params: FxParamsOut) {
    const random = seededRandom(seed);
    const ox = random();
    const oy = random();
    for (let i = 0; i < TENTACLES.full; i++) {
      this.tentacles.push({
        rx: (frac(halton(i + 1, 2) + ox) - 0.5) * 0.84,
        ry: (frac(halton(i + 1, 3) + oy) - 0.5) * 0.84,
        dir: random() * TAU,
        len: 0.8 + random() * 0.5,
        width: 0.22 + random() * 0.08,
        phase: random(),
        period: 4 + random() * 3,
        curl: 1.2 + random() * 1.4,
      });
    }
    for (let i = 0; i < BUBBLES.full; i++) {
      this.bubbles.push({
        x: (random() - 0.5) * 0.9,
        y: (random() - 0.5) * 0.9,
        phase: random(),
        period: 2.4 + random() * 1.6,
      });
    }
    for (let j = 0; j < EDGE * 4; j++) this.edge.push(random() * TAU);
    this.grabAngle = random() * TAU;
  }

  particles(level: DrawLevel): number {
    return TENTACLES[level] + BUBBLES[level];
  }

  reset(_f: AuraFrame): void {}

  step(_dt: number, _f: AuraFrame): void {}

  /** Local (square) px → map px. */
  private world(f: AuraFrame, lx: number, ly: number): Pt {
    const a = f.angle ?? 0;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [f.x + lx * c - ly * s, f.y + lx * s + ly * c];
  }

  /** The tentacles this square draws now: about two per three squares, capped per level. */
  private count(f: AuraFrame): number {
    const side = f.size / (f.cell || 1);
    const n = Math.round(side * side * PER_CELL);
    return Math.max(3, Math.min(TENTACLES[f.level], n));
  }

  under(ctx: CanvasRenderingContext2D, f: AuraFrame): void {
    const h = f.size / 2;
    // The pool: two ragged squares, the outer one with a rim.
    for (const [k, scale, alpha] of [
      [0, 1, 0.62],
      [1, 0.8, 0.35],
    ] as const) {
      ctx.beginPath();
      for (let j = 0; j < EDGE * 4; j++) {
        const side = Math.floor(j / EDGE);
        const u = (j % EDGE) / EDGE;
        const along = (u * 2 - 1) * h * scale;
        const out = h * scale + f.size * 0.025 * Math.sin((this.edge[j] ?? 0) + f.t * 1.1 + k);
        const [lx, ly] =
          side === 0
            ? [along, -out]
            : side === 1
              ? [out, along]
              : side === 2
                ? [-along, out]
                : [-out, -along];
        const [x, y] = this.world(f, lx, ly);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.globalAlpha = alpha * f.alpha;
      ctx.fillStyle = `rgb(${INK})`;
      ctx.fill();
      if (k === 0) {
        ctx.globalAlpha = 0.25 * f.alpha;
        ctx.strokeStyle = `rgb(${RIM})`;
        ctx.lineWidth = Math.max(1, f.cell * 0.03);
        ctx.stroke();
      }
    }
    // Oily bubbles rising and popping.
    const nb = BUBBLES[f.level];
    for (let i = 0; i < nb; i++) {
      const b = this.bubbles[i] as Bubble;
      const c = frac(f.t / b.period + b.phase);
      const [x, y] = this.world(f, b.x * f.size, b.y * f.size);
      dot(ctx, SHEEN, x, y, f.cell * 0.09 * c, 0.45 * Math.sin(c * Math.PI) * f.alpha);
    }
    const n = this.count(f);
    for (let i = 0; i < n; i++) this.drawTentacle(ctx, f, this.tentacles[i] as Tentacle, 0, 1);
    ctx.globalAlpha = 1;
  }

  over(ctx: CanvasRenderingContext2D, f: AuraFrame, reactions: readonly AuraReaction[]): void {
    const n = this.count(f);
    for (let i = 0; i < n; i++) {
      this.drawTentacle(ctx, f, this.tentacles[i] as Tentacle, 0.5, 0.45);
    }
    for (const r of reactions) if (r.kind === "strike") this.grab(ctx, f, r);
    ctx.globalAlpha = 1;
  }

  /** Height 0.25–1: rises out of the pool, writhes, sinks back, on its own cycle. */
  private height(p: Tentacle, t: number): number {
    const c = frac(t / p.period + p.phase);
    const rise = ease(c / 0.18);
    const sink = c > 0.82 ? 1 - ease((c - 0.82) / 0.18) : 1;
    return 0.25 + 0.75 * Math.min(rise, sink);
  }

  /** The spine from the root (local px), `SEG + 1` points, and the widths along it. */
  private spine(f: AuraFrame, p: Tentacle): { pts: Pt[]; widths: number[]; normals: Pt[] } {
    const t = f.t;
    const hgt = this.height(p, t);
    const step = (p.len * f.cell * hgt) / SEG;
    const base = p.dir + 0.5 * Math.sin(t * 0.9 + p.phase * TAU);
    let x = p.rx * f.size;
    let y = p.ry * f.size;
    const pts: Pt[] = [[x, y]];
    const normals: Pt[] = [];
    const widths: number[] = [];
    for (let k = 0; k <= SEG; k++) {
      const u = k / SEG;
      const phi =
        base +
        p.curl * u * u * Math.sin(t * 1.7 + p.phase * 7) +
        0.35 * Math.sin(u * 6 - t * 3.2 + p.phase * TAU);
      normals.push([-Math.sin(phi), Math.cos(phi)]);
      widths.push(p.width * f.cell * (1 - u) ** 0.85 * (0.6 + 0.4 * hgt) + 0.6);
      if (k < SEG) {
        x += Math.cos(phi) * step;
        y += Math.sin(phi) * step;
        pts.push([x, y]);
      }
    }
    return { pts, widths, normals };
  }

  /** A tapered tentacle from `from` (0 = root, 0.5 = its upper half) at `alpha`. */
  private drawTentacle(
    ctx: CanvasRenderingContext2D,
    f: AuraFrame,
    p: Tentacle,
    from: number,
    alpha: number,
  ): void {
    const { pts, widths, normals } = this.spine(f, p);
    const k0 = Math.round(from * SEG);
    const side = (k: number, sign: number): Pt => {
      const [px, py] = pts[k] as Pt;
      const [nx, ny] = normals[k] as Pt;
      const w = ((widths[k] ?? 0) / 2) * sign;
      return this.world(f, px + nx * w, py + ny * w);
    };
    ctx.beginPath();
    for (let k = k0; k <= SEG; k++) {
      const [x, y] = side(k, 1);
      if (k === k0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let k = SEG; k >= k0; k--) {
      const [x, y] = side(k, -1);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.95 * alpha * f.alpha;
    ctx.fillStyle = `rgb(${INK})`;
    ctx.fill();
    // Sheen down one side.
    ctx.beginPath();
    for (let k = k0; k <= SEG - 1; k++) {
      const [x, y] = side(k, 0.45);
      if (k === k0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.45 * alpha * f.alpha;
    ctx.strokeStyle = `rgb(${SHEEN})`;
    ctx.lineWidth = Math.max(1, f.cell * 0.025);
    ctx.lineCap = "round";
    ctx.stroke();
    // Suckers down the other.
    for (let k = Math.max(k0, 2); k <= SEG - 2; k += 2) {
      const [x, y] = side(k, -0.5);
      dot(ctx, SUCKER, x, y, (widths[k] ?? 0) * 0.28, 0.3 * alpha * f.alpha);
    }
  }

  /** FR-VFX-40 strike: three tentacles rise around the creature and coil it; a squeeze ring. */
  private grab(ctx: CanvasRenderingContext2D, f: AuraFrame, r: AuraReaction): void {
    if (r.age >= GRAB_S) return;
    const out = ease(r.age / 0.4);
    const release = r.age > 0.85 ? ease((r.age - 0.85) / (GRAB_S - 0.85)) : 0;
    const p = out * (1 - release);
    if (p <= 0) return;
    const rr = f.cell * 0.42;
    for (let k = 0; k < 3; k++) {
      const beta = this.grabAngle + (k * TAU) / 3;
      const path: Pt[] = [];
      const bx = r.toX + Math.cos(beta) * f.cell * 0.95;
      const by = r.toY + Math.sin(beta) * f.cell * 0.95;
      for (let i = 0; i <= 4; i++) {
        const u = i / 4;
        const d = f.cell * 0.95 + (rr - f.cell * 0.95) * u;
        const wob = Math.sin(u * 5 + r.age * 12 + k) * f.cell * 0.06;
        path.push([
          r.toX + Math.cos(beta) * d - Math.sin(beta) * wob,
          r.toY + Math.sin(beta) * d + Math.cos(beta) * wob,
        ]);
      }
      for (let i = 1; i <= 12; i++) {
        const a = beta + (i / 12) * Math.PI * 1.5;
        path.push([r.toX + Math.cos(a) * rr, r.toY + Math.sin(a) * rr]);
      }
      const shown = Math.max(2, Math.round(path.length * p));
      for (const [rgb, w, a] of [
        [INK, 0.14, 0.9],
        [SHEEN, 0.04, 0.35],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(bx, by);
        for (let i = 1; i < shown; i++) {
          const q = path[i] as Pt;
          ctx.lineTo(q[0], q[1]);
        }
        ctx.globalAlpha = a * f.alpha;
        ctx.strokeStyle = `rgb(${rgb})`;
        ctx.lineWidth = f.cell * w;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(r.toX, r.toY, rr * (1 - 0.08 * Math.sin(r.age * 18)), 0, TAU);
    ctx.globalAlpha = 0.5 * p * f.alpha;
    ctx.strokeStyle = `rgb(${INK})`;
    ctx.lineWidth = f.cell * 0.08;
    ctx.stroke();
  }
}

export const blackTentaclesRenderer: AuraRenderer = {
  preset: "black-tentacles",
  lagSeconds: 0.05,
  reactionSeconds: GRAB_S,
  create: (seed, params) => new BlackTentacles(seed, params),
};
