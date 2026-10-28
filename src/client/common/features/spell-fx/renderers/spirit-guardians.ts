// Spirit Guardians renderer (VFX §7.1, FR-VFX-02, -15). Under: a faint radial wash rising to
// the radius edge, a double ring with ~30 slowly turning runes, breathing alpha (≈ 4 s). Over:
// 6 spirits orbiting at 50–90 % of the radius on comet trails, each lagging the token a little,
// ~48 motes drifting inside. Radiant gold-white, necrotic green. Strike: the nearest free spirit
// darts to the creature and back (0.9 s), a flash ring on it.
import type { FxParamsOut } from "@shared/spell-fx/presets";
import {
  type AuraFrame,
  type AuraInstance,
  type AuraReaction,
  type AuraRenderer,
  type DrawLevel,
  ease,
  follow,
} from "../aura-types";
import { seededRandom } from "../prng";
import { dot, type Rgb } from "../sprites";

const TAU = Math.PI * 2;

interface Palette {
  core: Rgb;
  glow: Rgb;
  wash: Rgb;
}

const PALETTES: Record<string, Palette> = {
  radiant: { core: "255, 248, 225", glow: "255, 210, 110", wash: "255, 220, 140" },
  necrotic: { core: "215, 255, 205", glow: "110, 210, 120", wash: "120, 220, 140" },
};

const SPIRITS = 6;
const MOTES = { full: 48, reduced: 21, still: 48 } as const;
const TRAIL = { full: 8, reduced: 2, still: 5 } as const;
const RUNES = 30;
const STRIKE_S = 0.9;

interface Spirit {
  orbit: number; // fraction of the radius, 0.5–0.9
  speed: number; // rad / s, signed
  phase: number;
  bob: number;
  lag: number; // seconds
  x: number;
  y: number;
}

interface Mote {
  rho: number;
  angle: number;
  drift: number;
  rise: number;
  phase: number;
  size: number;
}

interface Rune {
  angle: number;
  strokes: [number, number, number, number][];
}

/** One seeded rune glyph: 2–3 short strokes in a unit box. */
function runeOf(random: () => number): Rune["strokes"] {
  const n = 2 + Math.floor(random() * 2);
  const out: Rune["strokes"] = [];
  for (let i = 0; i < n; i++) {
    out.push([random() - 0.5, random() - 0.5, random() - 0.5, random() - 0.5]);
  }
  return out;
}

class SpiritGuardians implements AuraInstance {
  private readonly spirits: Spirit[] = [];
  private readonly motes: Mote[] = [];
  private readonly runes: Rune[] = [];
  private readonly pal: Palette;

  constructor(seed: string, params: FxParamsOut) {
    const random = seededRandom(seed);
    this.pal = PALETTES[String(params.variant)] ?? (PALETTES.radiant as Palette);
    const dir = random() < 0.5 ? -1 : 1;
    for (let i = 0; i < SPIRITS; i++) {
      this.spirits.push({
        orbit: 0.5 + random() * 0.4,
        speed: dir * (0.55 + random() * 0.45),
        phase: (i / SPIRITS) * TAU + random() * 0.6,
        bob: random() * TAU,
        lag: 0.12 + random() * 0.22,
        x: 0,
        y: 0,
      });
    }
    for (let i = 0; i < MOTES.full; i++) {
      this.motes.push({
        rho: Math.sqrt(random()) * 0.92,
        angle: random() * TAU,
        drift: (random() - 0.5) * 0.25,
        rise: 0.05 + random() * 0.1,
        phase: random(),
        size: 0.04 + random() * 0.05,
      });
    }
    for (let i = 0; i < RUNES; i++) {
      this.runes.push({ angle: (i / RUNES) * TAU, strokes: runeOf(random) });
    }
  }

  particles(level: DrawLevel): number {
    return SPIRITS * (1 + TRAIL[level]) + MOTES[level];
  }

  reset(f: AuraFrame): void {
    for (const s of this.spirits) {
      s.x = f.x;
      s.y = f.y;
    }
  }

  step(dt: number, f: AuraFrame): void {
    for (const s of this.spirits) {
      const k = follow(dt, s.lag);
      s.x += (f.x - s.x) * k;
      s.y += (f.y - s.y) * k;
    }
  }

  under(ctx: CanvasRenderingContext2D, f: AuraFrame): void {
    const R = f.radius;
    const breathe = 0.8 + 0.2 * Math.sin((f.t / 4) * TAU);
    // Wash: stacked translucent discs rising toward the edge (no per-frame gradient).
    ctx.fillStyle = `rgb(${this.pal.wash})`;
    for (const [r, a] of [
      [1, 0.07],
      [0.82, 0.04],
      [0.6, 0.025],
    ] as const) {
      ctx.globalAlpha = a * breathe * f.alpha;
      ctx.beginPath();
      ctx.arc(f.x, f.y, R * r, 0, TAU);
      ctx.fill();
    }
    // Double ring at the edge.
    const gap = Math.max(2, f.cell * 0.14);
    ctx.strokeStyle = `rgb(${this.pal.glow})`;
    ctx.lineWidth = Math.max(1, f.cell * 0.03);
    ctx.globalAlpha = 0.55 * breathe * f.alpha;
    ctx.beginPath();
    ctx.arc(f.x, f.y, R, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.35 * breathe * f.alpha;
    ctx.beginPath();
    ctx.arc(f.x, f.y, R - gap, 0, TAU);
    ctx.stroke();
    // Runes between the rings, turning slowly.
    const turn = f.t * 0.08;
    const box = gap * 0.8;
    const mid = R - gap / 2;
    ctx.globalAlpha = 0.6 * breathe * f.alpha;
    ctx.lineWidth = Math.max(0.8, f.cell * 0.02);
    ctx.beginPath();
    for (const r of this.runes) {
      const a = r.angle + turn;
      const cx = f.x + Math.cos(a) * mid;
      const cy = f.y + Math.sin(a) * mid;
      for (const [x0, y0, x1, y1] of r.strokes) {
        ctx.moveTo(cx + x0 * box, cy + y0 * box);
        ctx.lineTo(cx + x1 * box, cy + y1 * box);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private spiritAt(s: Spirit, f: AuraFrame, t: number) {
    const a = s.phase + s.speed * t;
    const r = f.radius * s.orbit * (1 + 0.04 * Math.sin(t * 1.7 + s.bob));
    return { x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r };
  }

  over(ctx: CanvasRenderingContext2D, f: AuraFrame, reactions: readonly AuraReaction[]): void {
    const { core, glow } = this.pal;
    const R = f.radius;
    // Motes.
    const motes = MOTES[f.level];
    for (let i = 0; i < motes; i++) {
      const m = this.motes[i] as Mote;
      const life = (f.t * m.rise + m.phase) % 1;
      const a = m.angle + f.t * m.drift;
      const x = f.x + Math.cos(a) * m.rho * R;
      const y = f.y + Math.sin(a) * m.rho * R - life * f.cell * 0.6;
      const twinkle = Math.sin(life * Math.PI);
      dot(ctx, glow, x, y, f.cell * m.size, 0.55 * twinkle * f.alpha);
    }
    // Strike targets: the nearest free spirit per strike.
    const striking = new Map<number, AuraReaction>();
    for (const r of reactions) {
      if (r.kind !== "strike" || r.age >= STRIKE_S) continue;
      let best = -1;
      let bestD = Number.POSITIVE_INFINITY;
      this.spirits.forEach((s, i) => {
        if (striking.has(i)) return;
        const p = this.spiritAt(s, f, f.t);
        const d = (p.x - r.toX) ** 2 + (p.y - r.toY) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best >= 0) striking.set(best, r);
    }
    // Spirits on comet trails.
    const trail: number = TRAIL[f.level];
    const sz = f.cell * 0.16;
    this.spirits.forEach((s, i) => {
      const r = striking.get(i);
      for (let k = trail; k >= 0; k--) {
        const tk = f.t - k * 0.045;
        let p = this.spiritAt(s, f, tk);
        if (r) {
          const q = ease(
            Math.sin(Math.PI * Math.min(1, Math.max(0, (r.age - k * 0.03) / STRIKE_S))),
          );
          p = { x: p.x + (r.toX - p.x) * q, y: p.y + (r.toY - p.y) * q };
        }
        const fade = 1 - k / (trail + 1);
        if (k === 0) {
          dot(ctx, glow, p.x, p.y, sz * 2.2, 0.55 * f.alpha);
          dot(ctx, core, p.x, p.y, sz, 0.95 * f.alpha);
        } else {
          dot(ctx, glow, p.x, p.y, sz * (1.4 * fade + 0.3), 0.45 * fade * f.alpha);
        }
      }
    });
    // Flash ring on a struck creature, at the dart's turn.
    for (const r of reactions) {
      if (r.kind !== "strike") continue;
      const p = (r.age - STRIKE_S * 0.4) / (STRIKE_S * 0.6);
      if (p < 0 || p > 1) continue;
      ctx.globalAlpha = (1 - p) * 0.8 * f.alpha;
      ctx.strokeStyle = `rgb(${core})`;
      ctx.lineWidth = Math.max(1, f.cell * 0.05) * (1 - p * 0.6);
      ctx.beginPath();
      ctx.arc(r.toX, r.toY, f.cell * (0.25 + 0.3 * ease(p)), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

export const spiritGuardiansRenderer: AuraRenderer = {
  preset: "spirit-guardians",
  lagSeconds: 0.12,
  reactionSeconds: STRIKE_S,
  create: (seed, params) => new SpiritGuardians(seed, params),
};
