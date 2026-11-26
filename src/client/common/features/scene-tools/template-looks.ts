// Template looks (SCN FR-SCN-64, -67–71; #466): the subtle graphic a kept or ephemeral AoE
// template can carry. Append-only registry, one generic look per key: Mist, Motes, Ground, Glow,
// Ripple, Swirl, Hatch. A look's particles are pure functions of (seed, index, time), so every
// viewer draws the same pattern (seeded by the template id, or an ephemeral's key) and a Still
// frame is a fixed time. `drawTemplateLook` clips to the template's true outline and the map,
// fades particles near the edge (≈ ⅓ cell) and keeps the peak alpha low. DOM-free.
import type { TemplateLook } from "@shared/scene-tools/schemas";
import { STILL_T } from "../spell-fx/aura-types";
import type { FxLevel } from "../spell-fx/prefs";
import { seededRandom } from "../spell-fx/prng";
import type { TemplateOutline } from "./templates";

/** The level a look draws at (Off draws none). */
export type LookLevel = Exclude<FxLevel, "off">;

/** FR-SCN-71: at most this many particles per template at Full. */
export const LOOK_PARTICLES_MAX = 60;
/** FR-SCN-70: Reduced draws at most this share of Full's particles. */
export const LOOK_REDUCED_SHARE = 0.45;
/** FR-SCN-69: no look draws a particle more opaque than this. */
export const LOOK_ALPHA_MAX = 0.45;

/** What a look draws from, in map px. */
export interface LookFrame {
  /** FX clock seconds (Still: `STILL_T`). */
  t: number;
  level: LookLevel;
  /** Map px per cell. */
  cell: number;
  /** Bounding box of the outline. */
  box: { x: number; y: number; w: number; h: number };
  /** The template's origin (rings, glow and swirls centre here). */
  origin: { x: number; y: number };
  /** Particles to draw (already scaled for level and budget). */
  count: number;
  tint: string;
  /** 0–1 per point: fades particles toward the outline. */
  edge(x: number, y: number): number;
  rnd: () => number;
}

export interface TemplateLookDef {
  key: TemplateLook;
  label: string;
  /** Tooltip examples (FR-SCN-66). */
  examples: string;
  /** The look's own colour (`tint` null). */
  tint: string;
  /** Moves at Full / Reduced; Ground and Hatch never do (FR-SCN-70). */
  animated: boolean;
  /** FR-SCN-71: Full's particle count for an area of `cells` affected squares. */
  particles(cells: number): number;
  draw(ctx: CanvasRenderingContext2D, f: LookFrame): void;
}

// ---------- helpers ----------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrap = (v: number, n: number) => ((v % n) + n) % n;
const capped = (cells: number, base: number, per: number, max = LOOK_PARTICLES_MAX) =>
  Math.max(1, Math.min(max, Math.round(base + cells * per)));

/** `#rrggbb` + alpha → `rgba(…)`. */
export function rgba(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${Math.round(clamp01(a) * 1000) / 1000})`;
}

/** A soft round puff: a radial gradient where the context has one, else a flat disc. */
function puff(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  tint: string,
  a: number,
) {
  if (a <= 0.003 || r <= 0) return;
  const g = ctx.createRadialGradient?.(x, y, 0, x, y, r);
  if (g) {
    g.addColorStop(0, rgba(tint, a));
    g.addColorStop(0.6, rgba(tint, a * 0.55));
    g.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = rgba(tint, a * 0.6);
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- the looks (FR-SCN-69) ----------

const mist: TemplateLookDef = {
  key: "mist",
  label: "Mist",
  examples: "Fog, smoke, Stinking Cloud; black for Darkness",
  tint: "#9aa3ad",
  animated: true,
  particles: (cells) => capped(cells, 4, 0.8),
  draw(ctx, f) {
    const { box, cell, t } = f;
    // A faint body so thin spots still read as cloud.
    ctx.fillStyle = rgba(f.tint, 0.06);
    ctx.fillRect(box.x, box.y, box.w, box.h);
    for (let i = 0; i < f.count; i++) {
      const u = f.rnd();
      const v = f.rnd();
      const r = cell * (0.8 + f.rnd() * 0.9);
      const speed = cell * (0.06 + f.rnd() * 0.1);
      const phase = f.rnd() * Math.PI * 2;
      const spanX = box.w + r * 2;
      const x = box.x - r + wrap(u * spanX + t * speed, spanX);
      const y = box.y + v * box.h + Math.sin(t * 0.25 + phase) * cell * 0.35;
      const breathe = 0.6 + 0.4 * Math.sin(t * 0.4 + phase);
      puff(ctx, x, y, r, f.tint, 0.27 * breathe * f.edge(x, y));
    }
  },
};

const motes: TemplateLookDef = {
  key: "motes",
  label: "Motes",
  examples: "Spores, embers, Faerie Fire, dust, any magic",
  tint: "#e8d27a",
  animated: true,
  particles: (cells) => capped(cells, 6, 1.5),
  draw(ctx, f) {
    const { box, cell, t } = f;
    for (let i = 0; i < f.count; i++) {
      const u = f.rnd();
      const v = f.rnd();
      const rise = cell * (0.08 + f.rnd() * 0.12);
      const phase = f.rnd() * Math.PI * 2;
      const r = cell * (0.04 + f.rnd() * 0.05);
      const x = box.x + u * box.w + Math.sin(t * 0.7 + phase) * cell * 0.15;
      const y = box.y + wrap(v * box.h - t * rise, box.h);
      const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.1 + phase));
      const a = LOOK_ALPHA_MAX * twinkle * f.edge(x, y);
      puff(ctx, x, y, r * 2.4, f.tint, a * 0.5);
      ctx.fillStyle = rgba(f.tint, a);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

const ground: TemplateLookDef = {
  key: "ground",
  label: "Ground",
  examples: "Thorns, rubble, ice, grease, difficult terrain",
  tint: "#7a8a4a",
  animated: false,
  particles: (cells) => capped(cells, 3, 1.5),
  draw(ctx, f) {
    const { box, cell } = f;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, cell * 0.05);
    for (let i = 0; i < f.count; i++) {
      const x = box.x + f.rnd() * box.w;
      const y = box.y + f.rnd() * box.h;
      const len = cell * (0.14 + f.rnd() * 0.14);
      const rot = f.rnd() * Math.PI * 2;
      const a = 0.38 * f.edge(x, y);
      if (a <= 0.003) continue;
      ctx.strokeStyle = rgba(f.tint, a);
      ctx.beginPath();
      // Three short spikes from a point: reads as thorns, caltrops or cracked ground.
      for (let k = 0; k < 3; k++) {
        const ang = rot + (k * Math.PI * 2) / 3;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      }
      ctx.stroke();
    }
  },
};

const glow: TemplateLookDef = {
  key: "glow",
  label: "Glow",
  examples: "Moonbeam, consecrated ground, auras",
  tint: "#f2e6b8",
  animated: true,
  particles: () => 1,
  draw(ctx, f) {
    const { box, origin, t } = f;
    const far = Math.max(
      Math.hypot(origin.x - box.x, origin.y - box.y),
      Math.hypot(origin.x - box.x - box.w, origin.y - box.y),
      Math.hypot(origin.x - box.x, origin.y - box.y - box.h),
      Math.hypot(origin.x - box.x - box.w, origin.y - box.y - box.h),
    );
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.1);
    puff(ctx, origin.x, origin.y, far * (0.9 + 0.1 * pulse), f.tint, 0.16 + 0.12 * pulse);
  },
};

const ripple: TemplateLookDef = {
  key: "ripple",
  label: "Ripple",
  examples: "Silence, sound, gravity, shockwaves",
  tint: "#8fb3d9",
  animated: true,
  particles: () => 3,
  draw(ctx, f) {
    const { box, origin, cell, t } = f;
    const far = Math.max(
      Math.hypot(origin.x - box.x, origin.y - box.y),
      Math.hypot(origin.x - box.x - box.w, origin.y - box.y - box.h),
      Math.hypot(origin.x - box.x - box.w, origin.y - box.y),
      Math.hypot(origin.x - box.x, origin.y - box.y - box.h),
    );
    const rings = Math.max(1, f.count);
    ctx.lineWidth = Math.max(1, cell * 0.08);
    for (let k = 0; k < rings; k++) {
      const p = wrap(t * 0.18 + k / rings, 1);
      const r = p * far;
      ctx.strokeStyle = rgba(f.tint, 0.4 * Math.sin(Math.PI * p));
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, Math.max(0.5, r), 0, Math.PI * 2);
      ctx.stroke();
    }
  },
};

const swirl: TemplateLookDef = {
  key: "swirl",
  label: "Swirl",
  examples: "Whirlwind, Hunger of Hadar, storms",
  tint: "#8a7fb8",
  animated: true,
  particles: (cells) => capped(cells, 4, 0.8, 40),
  draw(ctx, f) {
    const { box, origin, cell, t } = f;
    const far = Math.max(box.w, box.h) * 0.75;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, cell * 0.06);
    for (let i = 0; i < f.count; i++) {
      const rho = cell * 0.3 + f.rnd() * far;
      const start = f.rnd() * Math.PI * 2;
      const span = 0.35 + f.rnd() * 0.45;
      // Inner streaks turn faster, as a vortex.
      const w = 0.5 * (cell / Math.max(cell, rho)) + 0.08;
      const a0 = start + t * w;
      const mx = origin.x + Math.cos(a0 + span / 2) * rho;
      const my = origin.y + Math.sin(a0 + span / 2) * rho;
      const a = 0.32 * f.edge(mx, my);
      if (a <= 0.003) continue;
      ctx.strokeStyle = rgba(f.tint, a);
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, rho, a0, a0 + span);
      ctx.stroke();
    }
  },
};

const hatch: TemplateLookDef = {
  key: "hatch",
  label: "Hatch",
  examples: "Any hazard, no motion",
  tint: "#c0504d",
  animated: false,
  particles: () => 1,
  draw(ctx, f) {
    const { box, cell } = f;
    const gap = cell * 0.5;
    ctx.lineWidth = Math.max(1, cell * 0.1);
    ctx.strokeStyle = rgba(f.tint, 0.3);
    ctx.beginPath();
    // 45° stripes across the box (the clip keeps them inside the outline).
    for (let d = -box.h; d < box.w; d += gap) {
      ctx.moveTo(box.x + d, box.y + box.h);
      ctx.lineTo(box.x + d + box.h, box.y);
    }
    ctx.stroke();
  },
};

/** FR-SCN-69: the registry (append-only; the panel lists them in this order). */
export const TEMPLATE_LOOK_DEFS: readonly TemplateLookDef[] = [
  mist,
  motes,
  ground,
  glow,
  ripple,
  swirl,
  hatch,
];

const byKey = new Map(TEMPLATE_LOOK_DEFS.map((d) => [d.key, d]));

/** FR-SCN-73: an unknown key draws no look. */
export const lookDef = (key: string | null | undefined): TemplateLookDef | null =>
  key ? (byKey.get(key as TemplateLook) ?? null) : null;

/** FR-SCN-64: the drawn tint: the template's, else the look's own colour. */
export const lookTint = (look: string | null | undefined, tint: string | null | undefined) =>
  tint ?? lookDef(look)?.tint ?? null;

/** FR-SCN-70, -71: the particles a look draws at `level`, given the budget `share` (0–1). */
export function lookCount(
  def: TemplateLookDef,
  cells: number,
  level: LookLevel,
  share = 1,
): number {
  const full = def.particles(cells);
  if (!def.animated || level === "still") return full;
  const atLevel = level === "reduced" ? Math.floor(full * LOOK_REDUCED_SHARE) : full;
  return Math.max(1, Math.floor(atLevel * Math.max(0, Math.min(1, share))));
}

// ---------- outline geometry ----------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function outlineBox(o: TemplateOutline): Box {
  if (o.kind === "circle") return { x: o.x - o.r, y: o.y - o.r, w: o.r * 2, h: o.r * 2 };
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < o.points.length; i += 2) {
    const x = o.points[i] as number;
    const y = o.points[i + 1] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Distance from (x, y) to the outline's edge (map px). */
export function edgeDistance(o: TemplateOutline, x: number, y: number): number {
  if (o.kind === "circle") return Math.abs(o.r - Math.hypot(x - o.x, y - o.y));
  const p = o.points;
  const n = p.length >> 1;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const ax = p[i * 2] as number;
    const ay = p[i * 2 + 1] as number;
    const bx = p[((i + 1) % n) * 2] as number;
    const by = p[((i + 1) % n) * 2 + 1] as number;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const k = len2 === 0 ? 0 : clamp01(((x - ax) * dx + (y - ay) * dy) / len2);
    const d = Math.hypot(x - (ax + k * dx), y - (ay + k * dy));
    if (d < best) best = d;
  }
  return best;
}

function outlinePath(ctx: CanvasRenderingContext2D, o: TemplateOutline): void {
  ctx.beginPath();
  if (o.kind === "circle") {
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    return;
  }
  const p = o.points;
  for (let i = 0; i + 1 < p.length; i += 2) {
    if (i === 0) ctx.moveTo(p[i] as number, p[i + 1] as number);
    else ctx.lineTo(p[i] as number, p[i + 1] as number);
  }
  ctx.closePath();
}

export interface DrawLookInput {
  def: TemplateLookDef;
  outline: TemplateOutline;
  /** The map rectangle (map px): the look is cut at the map's edge (FR-SCN-68). */
  map: Box;
  origin: { x: number; y: number };
  cell: number;
  /** Affected squares (FR-SCN-71 scales the particles by them). */
  cells: number;
  tint: string;
  seed: string;
  level: LookLevel;
  /** FX clock seconds; ignored at Still. */
  t: number;
  /** FR-SCN-71 budget share, 0–1. */
  share?: number;
}

/**
 * FR-SCN-68: draws one template's look clipped to its true outline and the map, with a soft
 * inner edge of ⅓ cell. Restores the context's state.
 */
export function drawTemplateLook(ctx: CanvasRenderingContext2D, d: DrawLookInput): void {
  const box = outlineBox(d.outline);
  if (box.w <= 0 || box.h <= 0) return;
  const soft = d.cell / 3;
  const outline = d.outline;
  ctx.save();
  ctx.beginPath();
  ctx.rect(d.map.x, d.map.y, d.map.w, d.map.h);
  ctx.clip();
  outlinePath(ctx, outline);
  ctx.clip();
  d.def.draw(ctx, {
    t: d.level === "still" || !d.def.animated ? STILL_T : d.t,
    level: d.level,
    cell: d.cell,
    box,
    origin: d.origin,
    count: lookCount(d.def, d.cells, d.level, d.share),
    tint: d.tint,
    edge: (x, y) => clamp01(edgeDistance(outline, x, y) / soft),
    rnd: seededRandom(`${d.seed}:${d.def.key}`),
  });
  ctx.restore();
}
