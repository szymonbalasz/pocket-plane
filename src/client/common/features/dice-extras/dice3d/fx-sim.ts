// FR-DICEX-106: the full effect of a damage die, a particle simulation with no three.js in it
// (tested headless). Each die sheds particles while it flies and bursts once when it lands; every
// particle moves with its own die (no trail behind it); the burst is over within LAND_S of rest
// (played slowed, on the landing clock), before the hand-off copies the dice (FR-DICEX-35). Big
// rolls share one budget: fewer particles per die as the dice add up, and never more than
// MAX_PARTICLES live per kind. The kinds' looks
// (presets, sprites, auras) live in fx-kinds/<kind>.ts.

/** A colour stop over a particle's life: at (0–1), r, g, b, a (0–1). */
export type Stop = readonly [number, number, number, number, number];

export interface Species {
  /** The sprite, by name: a core tile (fx-kinds/tiles.ts: dot, star) or one of the kind's own. */
  tile: string;
  /** Adds light (fire, glitter) or covers what is under it (smoke, mist, flakes). */
  additive: boolean;
  /** Seconds, min and max. */
  life: readonly [number, number];
  /** Diameter in die radii at birth and at death. */
  size: readonly [number, number];
  /** Speed outward at birth, die radii per second, min and max. */
  speed: readonly [number, number];
  /** Velocity lost per second. */
  drag: number;
  /** Steady drift, die radii per second, screen x and y (+y = down). */
  drift: readonly [number, number];
  /** Spin, radians per second, either way up to this. */
  spin: number;
  /** Born this far from the die's centre, die radii, min and max. */
  from: readonly [number, number];
  /** Height above the die's centre in die radii (> 1: over the die), or null: on the floor. */
  lift: number | null;
  ramp: readonly Stop[];
  /** Flicker per second (0: none). */
  twinkle: number;
}

export interface Emitter {
  /** Index into the preset's `species`. */
  species: number;
  /** Per second per die while it flies (before the budget). */
  rate: number;
  /** At landing, per die (before the budget). */
  burst: number;
  /** The burst's speed, × the species' speed. */
  burstSpeed: number;
}

/** The die's own glow while it flies (and its flare at the landing). */
export interface DieGlow {
  emissive: number;
  /** Emissive intensity, low and high. */
  range: readonly [number, number];
  /** Flicker speed. */
  hz: number;
  /** The die's body tinted toward this colour by `amount` while it flies (frost). */
  tint?: { color: number; amount: number };
}

export interface RichPreset {
  species: readonly Species[];
  emitters: readonly Emitter[];
  /** None: the die keeps its own look. */
  glow?: DieGlow;
}

/** Live particles of one kind in one throw, all its dice together. */
export const MAX_PARTICLES = 1400;
/**
 * The landing clock: the kinds' landing timelines (and landFade, landGlow, LAND_GLOW_S) are in
 * these seconds after rest, the pace they were drawn at; all of it is over by LAND_CLOCK_S on it.
 */
export const LAND_CLOCK_S = 0.9;
/**
 * The landing is over this long after rest, real seconds, before the hand-off at rest + 1.5 s
 * (FR-DICEX-35). DM, 2026-11-06: 0.9 → 1.4 s so the hits and pops read; the whole landing plays
 * slower (LAND_PACE), no dead time added at the end.
 */
export const LAND_S = 1.4;
/** Landing-clock seconds per real second after rest (< 1: slower). */
export const LAND_PACE = LAND_CLOCK_S / LAND_S;
/** Real seconds since rest → the landing clock. */
export const landClock = (sinceRest: number): number => sinceRest * LAND_PACE;
/** Particles start fading this long after rest (landing clock). */
const LAND_FADE_FROM = 0.45;
/** The aura and the die's glow are gone this long after rest (landing clock), so the value reads clean. */
export const LAND_GLOW_S = 0.4;

/** Per-die share of the full effect for `n` dice: 1 up to two dice, then thinner. */
export const budgetScale = (n: number): number => (n <= 2 ? 1 : Math.sqrt(2 / n));

/** A small seeded PRNG (mulberry32): the same throw sheds the same particles on every client. */
export function prng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A die as the simulation sees it (world units; the camera looks straight down: x, z). */
export interface SimDie {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** A particle ready to draw. */
export interface Drawn {
  x: number;
  y: number;
  z: number;
  /** Diameter, world units. */
  size: number;
  rot: number;
  tile: string;
  additive: boolean;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface RichSim {
  preset: RichPreset;
  /** Advance by `dt` seconds; the dice shed particles while `flying`. */
  step(dt: number, dice: readonly SimDie[], flying: boolean): void;
  /** Each die bursts once (landing). */
  burst(dice: readonly SimDie[]): void;
  /** Live particles. */
  readonly count: number;
  /** Particle `i` (0 ≤ i < count), its colour × `fade`. */
  drawn(i: number, fade: number): Drawn;
  clear(): void;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The ramp's colour at `t` (0–1). */
export function rampAt(ramp: readonly Stop[], t: number): [number, number, number, number] {
  const first = ramp[0] as Stop;
  if (t <= first[0]) return [first[1], first[2], first[3], first[4]];
  for (let k = 1; k < ramp.length; k++) {
    const b = ramp[k] as Stop;
    if (t <= b[0]) {
      const a = ramp[k - 1] as Stop;
      const u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return [lerp(a[1], b[1], u), lerp(a[2], b[2], u), lerp(a[3], b[3], u), lerp(a[4], b[4], u)];
    }
  }
  const last = ramp[ramp.length - 1] as Stop;
  return [last[1], last[2], last[3], last[4]];
}

/** Height of the floor particles: above the shadow floor and the old halo, below any die. */
const FLOOR_Y = 0.06;

/**
 * The simulation for `dieCount` dice of one kind. `whileRolling` false: nothing is shed in flight,
 * only the landing burst (physical types).
 */
export function richSim(
  preset: RichPreset,
  dieCount: number,
  seed: number,
  whileRolling = true,
): RichSim {
  const rand = prng(seed);
  const scale = budgetScale(dieCount);
  const cap = MAX_PARTICLES;
  const f = () => new Float32Array(cap);
  const px = f();
  const py = f();
  const pz = f();
  const vx = f();
  const vz = f();
  const age = f();
  const life = f();
  const rad = f();
  const rot = f();
  const spin = f();
  const phase = f();
  const sp = new Uint8Array(cap);
  /** The die a particle belongs to: its position is an offset from that die's. */
  const owner = new Uint16Array(cap);
  let n = 0;
  /** Per die: fractional particles owed per emitter. */
  const owed: number[][] = [];
  /** Per die: where it is now. */
  let at: readonly SimDie[] = [];

  const spawn = (s: number, k: number, d: SimDie, speedMul: number) => {
    if (n >= cap) return;
    const spec = preset.species[s] as Species;
    const a = rand() * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const from = d.r * lerp(spec.from[0], spec.from[1], rand());
    const speed = d.r * lerp(spec.speed[0], spec.speed[1], rand()) * speedMul;
    px[n] = ca * from;
    pz[n] = sa * from;
    py[n] = spec.lift === null ? 0 : spec.lift * d.r;
    vx[n] = ca * speed;
    vz[n] = sa * speed;
    owner[n] = k;
    age[n] = 0;
    life[n] = lerp(spec.life[0], spec.life[1], rand());
    rad[n] = d.r * lerp(0.75, 1.25, rand());
    rot[n] = rand() * Math.PI * 2;
    spin[n] = (rand() * 2 - 1) * spec.spin;
    phase[n] = rand() * Math.PI * 2;
    sp[n] = s;
    n++;
  };

  const kill = (i: number) => {
    const j = --n;
    if (i === j) return;
    px[i] = px[j] as number;
    py[i] = py[j] as number;
    pz[i] = pz[j] as number;
    vx[i] = vx[j] as number;
    vz[i] = vz[j] as number;
    age[i] = age[j] as number;
    life[i] = life[j] as number;
    rad[i] = rad[j] as number;
    rot[i] = rot[j] as number;
    spin[i] = spin[j] as number;
    phase[i] = phase[j] as number;
    sp[i] = sp[j] as number;
    owner[i] = owner[j] as number;
  };

  return {
    preset,
    get count() {
      return n;
    },
    step(dt, dice, flying) {
      at = dice;
      if (dt <= 0) return;
      // Move and age.
      for (let i = n - 1; i >= 0; i--) {
        const a = (age[i] as number) + dt;
        if (a >= (life[i] as number)) {
          kill(i);
          continue;
        }
        age[i] = a;
        const spec = preset.species[sp[i] as number] as Species;
        const keep = Math.exp(-spec.drag * dt);
        vx[i] = (vx[i] as number) * keep;
        vz[i] = (vz[i] as number) * keep;
        const r = rad[i] as number;
        px[i] = (px[i] as number) + ((vx[i] as number) + spec.drift[0] * r) * dt;
        pz[i] = (pz[i] as number) + ((vz[i] as number) + spec.drift[1] * r) * dt;
        rot[i] = (rot[i] as number) + (spin[i] as number) * dt;
      }
      // Shed.
      if (!flying || !whileRolling) return;
      dice.forEach((d, k) => {
        const debt = owed[k] ?? preset.emitters.map(() => rand());
        owed[k] = debt;
        preset.emitters.forEach((e, j) => {
          let due = (debt[j] as number) + e.rate * scale * dt;
          while (due >= 1) {
            spawn(e.species, k, d, 1);
            due -= 1;
          }
          debt[j] = due;
        });
      });
    },
    burst(dice) {
      at = dice;
      dice.forEach((d, k) => {
        for (const e of preset.emitters) {
          const count = Math.round(e.burst * scale);
          for (let i = 0; i < count; i++) spawn(e.species, k, d, e.burstSpeed);
        }
      });
    },
    drawn(i, fade) {
      const spec = preset.species[sp[i] as number] as Species;
      const t = (age[i] as number) / (life[i] as number);
      const [r, g, b, a0] = rampAt(spec.ramp, t);
      const tw =
        spec.twinkle > 0
          ? 0.55 + 0.45 * Math.sin((age[i] as number) * spec.twinkle * 6.283 + (phase[i] as number))
          : 1;
      const d = at[owner[i] as number] ?? { x: 0, y: 0, z: 0, r: 0 };
      return {
        x: d.x + (px[i] as number),
        y: spec.lift === null ? FLOOR_Y : d.y + (py[i] as number),
        z: d.z + (pz[i] as number),
        size: (rad[i] as number) * lerp(spec.size[0], spec.size[1], t),
        rot: rot[i] as number,
        tile: spec.tile,
        additive: spec.additive,
        r,
        g,
        b,
        a: a0 * tw * fade,
      };
    },
    clear() {
      n = 0;
    },
  };
}

/** How far into the landing (landing clock) the particles still show (1 → 0). */
export function landFade(sinceRest: number): number {
  if (sinceRest <= LAND_FADE_FROM) return 1;
  return Math.max(0, 1 - (sinceRest - LAND_FADE_FROM) / (LAND_CLOCK_S - LAND_FADE_FROM));
}

/** The aura and the die's glow over the landing (landing clock): a flare at the impact, then gone. */
export function landGlow(sinceRest: number): number {
  if (sinceRest >= LAND_GLOW_S) return 0;
  const u = sinceRest / LAND_GLOW_S;
  return 1.25 * (1 - u) * (1 - u);
}

/**
 * The aura's and the die's glow strength: in over the first moments of the throw and at full until
 * the landing flares it out (`sinceRest`: null in flight). `whileRolling` false: none in flight.
 */
export function richAmp(whileRolling: boolean, progress: number, sinceRest: number | null): number {
  if (sinceRest !== null) return landGlow(sinceRest);
  return whileRolling ? Math.min(1, progress / 0.06) : 0;
}

/** The die's glow level (0–1) `t` seconds in. */
export function richFlicker(glow: DieGlow, t: number, seed: number): number {
  return (
    0.5 + 0.3 * Math.sin(t * glow.hz * 2.1 + seed) + 0.2 * Math.sin(t * glow.hz * 5.3 + seed * 2)
  );
}
