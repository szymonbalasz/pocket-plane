// FR-DICEX-106: what a damage die does while it rolls, per damage type: a subtle glow on the die
// and a few motes around it (lightning: hard flashes), gone by the time it rests so the value
// reads clean. Fire and cold have the full effect instead in 3D (`rich`: flames or frost around
// the die, a trail, a short landing burst; dice3d/fx-sim.ts); their numbers here still drive the
// flat die's glow. Physical types have none. Pure: the 3D renderer and the flat die
// draw from these numbers; every client computes the same from the roll's type (no server part).
import type { PartDamageType } from "@shared/effect-modifiers/schemas";

export interface DieFx {
  /** The die's glow and the halo under it. */
  color: number;
  /** The motes. */
  spark: number;
  /** Glow strength, low to high (emissive intensity). */
  glow: readonly [number, number];
  /** Flicker speed (per second). */
  hz: number;
  /** Hard flashes instead of a smooth flicker. */
  zap?: boolean;
  /** Mote drift, die radii per second, screen x and y (+y = down). */
  drift: readonly [number, number];
  /** Mote speed outward, die radii per second. */
  out?: number;
  /** Mote orbit, radians per second. */
  spin?: number;
  /** Where motes start, in die radii from the centre. */
  spread: number;
  /** A mote's life (seconds). */
  life: number;
  /** The full 3D effect (dice3d/fx-rich.ts) in place of the glow and motes. */
  rich?: "fire" | "frost";
}

const DIE_FX: Record<PartDamageType, DieFx | null> = {
  bludgeoning: null,
  piercing: null,
  slashing: null,
  acid: {
    color: 0x7ed321,
    spark: 0xb8f04a,
    glow: [0.2, 0.45],
    hz: 4,
    drift: [0, 1],
    spread: 0.7,
    life: 0.8,
  },
  cold: {
    color: 0x66c8ff,
    spark: 0xd8f3ff,
    glow: [0.2, 0.4],
    hz: 1.5,
    drift: [0, 0.35],
    spread: 1,
    life: 1.1,
    rich: "frost",
  },
  fire: {
    color: 0xff6a1a,
    spark: 0xffb347,
    glow: [0.25, 0.7],
    hz: 9,
    drift: [0, -1.6],
    spread: 0.7,
    life: 0.7,
    rich: "fire",
  },
  force: {
    color: 0x5f7bff,
    spark: 0xb0c0ff,
    glow: [0.2, 0.5],
    hz: 3,
    drift: [0, 0],
    spin: 3,
    spread: 1.1,
    life: 1,
  },
  lightning: {
    color: 0x7aa8ff,
    spark: 0xe6f0ff,
    glow: [0.1, 0.6],
    hz: 14,
    zap: true,
    drift: [0, 0],
    spread: 1.1,
    life: 0.18,
  },
  necrotic: {
    color: 0x6a3fa0,
    spark: 0x9a6fd0,
    glow: [0.2, 0.45],
    hz: 2.5,
    drift: [0, 0.7],
    spread: 0.8,
    life: 1,
  },
  poison: {
    color: 0x6fae3a,
    spark: 0xa8d060,
    glow: [0.15, 0.35],
    hz: 2,
    drift: [0.2, -0.6],
    spread: 0.9,
    life: 1.2,
  },
  psychic: {
    color: 0xe05fd0,
    spark: 0xf5a8ec,
    glow: [0.2, 0.5],
    hz: 4,
    drift: [0, 0],
    spin: -2.4,
    spread: 1,
    life: 1,
  },
  radiant: {
    color: 0xffd76a,
    spark: 0xfff2b0,
    glow: [0.25, 0.6],
    hz: 3,
    drift: [0, -0.8],
    out: 0.3,
    spread: 0.8,
    life: 0.9,
  },
  thunder: {
    color: 0x8f8cff,
    spark: 0xc8c6ff,
    glow: [0.15, 0.45],
    hz: 3,
    drift: [0, 0],
    out: 1.6,
    spread: 0.8,
    life: 0.6,
  },
};

/** The effect of a roll item's damage type; none for physical, untyped or unknown types. */
export const dieFxOf = (type: string | null | undefined): DieFx | null =>
  type && Object.hasOwn(DIE_FX, type) ? DIE_FX[type as PartDamageType] : null;

/** A CSS colour of `n`. */
export const fxCss = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

/** A flat die's glow colour for this damage type, if it has an effect. */
export function flatGlow(type: string | null | undefined): string | undefined {
  const fx = dieFxOf(type);
  return fx ? fxCss(fx.color) : undefined;
}

/** Over a throw's progress (0–1): up quickly, then gone by its end so the die rests clean. */
export function fxEnvelope(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return Math.min(1, p / 0.06) * (p > 0.7 ? (1 - p) / 0.3 : 1);
}

/** A stable pseudo-random 0–1 of two numbers. */
function hash(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The glow's strength `t` seconds in, per die (`seed`). */
export function fxGlow(fx: DieFx, t: number, seed: number): number {
  const [low, high] = fx.glow;
  const level = fx.zap
    ? hash(seed + 1, Math.floor(t * fx.hz)) > 0.65
      ? 1
      : 0
    : 0.5 + 0.3 * Math.sin(t * fx.hz * 2.1 + seed) + 0.2 * Math.sin(t * fx.hz * 5.3 + seed * 2);
  return low + (high - low) * level;
}

export interface FxMote {
  /** Offset from the die's centre, in die radii (screen x and y, +y = down). */
  x: number;
  y: number;
  /** 0–1. */
  alpha: number;
}

/** Mote `i` of die `seed`, `t` seconds in: born around the die, drifting, fading in and out. */
export function fxMote(fx: DieFx, seed: number, i: number, t: number): FxMote {
  const clock = t / fx.life + hash(seed, i);
  const cycle = Math.floor(clock);
  const age = clock - cycle;
  const at = fx.life * age;
  const r = fx.spread * (0.6 + 0.6 * hash(seed + i, cycle)) + (fx.out ?? 0) * at;
  const a = hash(i, seed + cycle) * Math.PI * 2 + (fx.spin ?? 0) * t;
  return {
    x: Math.cos(a) * r + fx.drift[0] * at,
    y: Math.sin(a) * r + fx.drift[1] * at,
    alpha: fx.zap ? (age < 0.5 ? 1 : 0) : Math.sin(Math.PI * age),
  };
}
