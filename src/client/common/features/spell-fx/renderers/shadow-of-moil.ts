// Shadow of Moil renderer (VFX §7.1, FR-VFX-02, -16, -17). Under: three stacked ragged pools of
// darkness to the radius edge, edges breathing, a faint violet rim. Over: black flame particles
// with a violet fringe rising off the token (≈ 75 / s at Full), trailing when it moves; the token
// covered (eyes only for players who don't own it, half for the DM and the owner) with two violet
// eyes that blink every 2.5–5.5 s. Lash: three shadow tendrils whip to the attacker (0.9 s) with
// a dark puff there.
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
const DARK = "12, 6, 20";
const VIOLET = "150, 90, 225";
const EYE = "205, 150, 255";

const FLAMES = { full: 75, reduced: 33, still: 75 } as const;
const FLAME_LIFE = 1;
const POOL_POINTS = 24;
const LASH_S = 0.9;
const PUFF = 8;

interface Flame {
  phase: number;
  ox: number;
  oy: number;
  sway: number;
  size: number;
  cycle: number;
  sx: number;
  sy: number;
}

interface Tendril {
  bend: number;
  whip: number;
}

class ShadowOfMoil implements AuraInstance {
  private readonly flames: Flame[] = [];
  private readonly pools: number[][] = [];
  private readonly tendrils: Tendril[] = [];
  private readonly puff: { a: number; d: number; s: number }[] = [];
  /** Cumulative blink times over one schedule cycle, and its length. */
  private readonly blinks: number[] = [];
  private readonly blinkCycle: number;

  constructor(seed: string, _params: FxParamsOut) {
    const random = seededRandom(seed);
    for (let i = 0; i < FLAMES.full; i++) {
      const a = random() * TAU;
      const r = Math.sqrt(random()) * 0.42;
      this.flames.push({
        phase: random(),
        ox: Math.cos(a) * r,
        oy: Math.sin(a) * r,
        sway: random() * TAU,
        size: 0.1 + random() * 0.12,
        cycle: Number.NaN,
        sx: 0,
        sy: 0,
      });
    }
    for (let k = 0; k < 3; k++) {
      const pts: number[] = [];
      for (let j = 0; j < POOL_POINTS; j++) pts.push(random() * TAU);
      this.pools.push(pts);
    }
    for (let i = 0; i < 3; i++) this.tendrils.push({ bend: random() - 0.5, whip: random() * TAU });
    for (let i = 0; i < PUFF; i++) {
      this.puff.push({ a: random() * TAU, d: 0.3 + random() * 0.5, s: 0.15 + random() * 0.15 });
    }
    let at = 0;
    for (let i = 0; i < 12; i++) {
      at += 2.5 + random() * 3;
      this.blinks.push(at);
    }
    this.blinkCycle = at;
  }

  particles(level: DrawLevel): number {
    return FLAMES[level];
  }

  reset(f: AuraFrame): void {
    for (const p of this.flames) {
      p.cycle = Math.floor((f.t + p.phase * FLAME_LIFE) / FLAME_LIFE);
      p.sx = f.x;
      p.sy = f.y;
    }
  }

  step(_dt: number, f: AuraFrame): void {
    // A flame respawns at the token's position each cycle, so a moving token leaves a trail.
    for (const p of this.flames) {
      const cycle = Math.floor((f.t + p.phase * FLAME_LIFE) / FLAME_LIFE);
      if (cycle === p.cycle) continue;
      p.cycle = cycle;
      p.sx = f.x;
      p.sy = f.y;
    }
  }

  under(ctx: CanvasRenderingContext2D, f: AuraFrame): void {
    const R = f.radius;
    const stack = [1, 0.8, 0.6];
    this.pools.forEach((pts, k) => {
      const rk = R * (stack[k] ?? 1);
      ctx.beginPath();
      for (let j = 0; j < POOL_POINTS; j++) {
        const a = (j / POOL_POINTS) * TAU;
        const rag = 0.9 + 0.07 * Math.sin((pts[j] ?? 0) + f.t * 1.3) + 0.03 * Math.sin(a * 5);
        const x = f.x + Math.cos(a) * rk * rag;
        const y = f.y + Math.sin(a) * rk * rag;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.globalAlpha = 0.28 * f.alpha;
      ctx.fillStyle = `rgb(${DARK})`;
      ctx.fill();
      if (k === 0) {
        ctx.globalAlpha = 0.3 * f.alpha;
        ctx.strokeStyle = `rgb(${VIOLET})`;
        ctx.lineWidth = Math.max(1, f.cell * 0.03);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }

  /** Eyes open (false = mid-blink) at time t. */
  private eyesOpen(t: number): boolean {
    const at = ((t % this.blinkCycle) + this.blinkCycle) % this.blinkCycle;
    return !this.blinks.some((b) => at >= b - 0.15 && at < b);
  }

  over(ctx: CanvasRenderingContext2D, f: AuraFrame, reactions: readonly AuraReaction[]): void {
    const s = f.size;
    // FR-VFX-17: the shadow over the token, under the flames and eyes.
    ctx.globalAlpha = (f.cover === "eyes" ? 0.95 : 0.5) * f.alpha;
    ctx.fillStyle = `rgb(${DARK})`;
    ctx.beginPath();
    ctx.arc(f.x, f.y, s * 0.52, 0, TAU);
    ctx.fill();
    // Flames rising.
    const n = FLAMES[f.level];
    for (let i = 0; i < n; i++) {
      const p = this.flames[i] as Flame;
      const age = ((f.t + p.phase * FLAME_LIFE) % FLAME_LIFE) / FLAME_LIFE;
      const x = p.sx + p.ox * s + Math.sin(p.sway + age * 5) * s * 0.06;
      const y = p.sy + p.oy * s - age * s * 0.9;
      const r = s * p.size * (1 - age * 0.6);
      const a = Math.sin(age * Math.PI) * f.alpha;
      dot(ctx, VIOLET, x, y, r * 1.5, 0.35 * a);
      dot(ctx, DARK, x, y, r, 0.85 * a);
    }
    // Eyes.
    if (this.eyesOpen(f.t)) {
      for (const dx of [-0.14, 0.14]) {
        dot(ctx, VIOLET, f.x + dx * s, f.y - 0.06 * s, s * 0.09, 0.7 * f.alpha);
        dot(ctx, EYE, f.x + dx * s, f.y - 0.06 * s, s * 0.04, 1 * f.alpha);
      }
    }
    for (const r of reactions) if (r.kind === "lash") this.lash(ctx, f, r);
    ctx.globalAlpha = 1;
  }

  private lash(ctx: CanvasRenderingContext2D, f: AuraFrame, r: AuraReaction): void {
    if (r.age >= LASH_S) return;
    const dx = r.toX - f.x;
    const dy = r.toY - f.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist;
    const ny = dx / dist;
    const out = ease(Math.min(1, r.age / (LASH_S * 0.4)));
    const back = r.age > LASH_S * 0.6 ? ease((r.age - LASH_S * 0.6) / (LASH_S * 0.4)) : 0;
    const tip = Math.max(0, out - back);
    for (const t of this.tendrils) {
      const bend = (t.bend * 0.7 + 0.25 * Math.sin(t.whip + r.age * 14)) * dist;
      const cx = f.x + dx / 2 + nx * bend;
      const cy = f.y + dy / 2 + ny * bend;
      for (const [rgb, w, a] of [
        [VIOLET, 0.12, 0.45],
        [DARK, 0.06, 0.9],
      ] as const) {
        ctx.globalAlpha = a * f.alpha;
        ctx.strokeStyle = `rgb(${rgb})`;
        ctx.lineWidth = f.cell * w;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        const steps = 12;
        for (let k = 1; k <= steps; k++) {
          const u = (k / steps) * tip;
          const x = (1 - u) ** 2 * f.x + 2 * (1 - u) * u * cx + u * u * r.toX;
          const y = (1 - u) ** 2 * f.y + 2 * (1 - u) * u * cy + u * u * r.toY;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    // A dark puff where the tendrils land.
    const p = (r.age - LASH_S * 0.35) / (LASH_S * 0.65);
    if (p > 0 && p < 1) {
      for (const q of this.puff) {
        const d = q.d * f.cell * 0.6 * ease(p);
        dot(
          ctx,
          DARK,
          r.toX + Math.cos(q.a) * d,
          r.toY + Math.sin(q.a) * d,
          f.cell * q.s * (1 + p),
          0.8 * (1 - p) * f.alpha,
        );
      }
    }
  }
}

export const shadowOfMoilRenderer: AuraRenderer = {
  preset: "shadow-of-moil",
  lagSeconds: 0.06,
  reactionSeconds: LASH_S,
  create: (seed, params) => new ShadowOfMoil(seed, params),
};
