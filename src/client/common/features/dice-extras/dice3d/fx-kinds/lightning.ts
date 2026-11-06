// FR-DICEX-106: lightning dice, the DM's direction (2026-11-06): crackling white and blue
// lightning. Jagged arcs crawl round the die and leap off it, re-forming many times a second (and
// between lightning dice that roll close), on a crackling blue corona, sparks and little zaps; the
// die flickers blue-white. Landing: a strike, a big bolt into the die with forks running across the
// floor and a flash, re-striking twice and gone well before LAND_S.
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  ShaderMaterial,
} from "three";
import { budgetScale, prng, type RichPreset } from "../fx-sim";
import type { RichExtra, RichKindDef, TileDraw } from "./kind";
import { AURA_HEAD, AURA_SHAPE } from "./shaders";
import { soft } from "./tiles";

const LIGHTNING: RichPreset = {
  species: [
    {
      // Sparks: thrown off the die, white going blue.
      tile: "dot",
      additive: true,
      life: [0.15, 0.35],
      size: [0.17, 0.05],
      speed: [2, 5],
      drag: 4,
      drift: [0, 0],
      spin: 0,
      from: [0.8, 1.05],
      lift: 1.2,
      ramp: [
        [0, 1, 1, 1, 1],
        [0.4, 0.7, 0.85, 1, 1],
        [1, 0.3, 0.5, 1, 0],
      ],
      twinkle: 18,
    },
    {
      // Zaps: tiny forked arcs flickering at the die's edge.
      tile: "lightning-zap",
      additive: true,
      life: [0.06, 0.14],
      size: [0.9, 1.15],
      speed: [0.1, 0.4],
      drag: 2,
      drift: [0, 0],
      spin: 0,
      from: [0.95, 1.3],
      lift: 1.25,
      ramp: [
        [0, 1, 1, 1, 1],
        [0.5, 0.75, 0.88, 1, 0.9],
        [1, 0.45, 0.65, 1, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 38, burst: 64, burstSpeed: 1.6 },
    { species: 1, rate: 42, burst: 26, burstSpeed: 5 },
  ],
  glow: { emissive: 0xa8d4ff, range: [0.15, 0.85], hz: 16 },
};

/** A tiny forked zigzag with a soft glow. */
const zap: TileDraw = (g, px) => {
  const h = px / 2;
  soft(g, h, h, h * 0.5, 0.35);
  g.save();
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineCap = "round";
  g.lineJoin = "round";
  g.shadowColor = "rgba(255,255,255,1)";
  g.shadowBlur = 12;
  const path = (pts: readonly (readonly [number, number])[], w: number) => {
    g.lineWidth = w;
    g.beginPath();
    pts.forEach(([x, y], i) => {
      if (i === 0) g.moveTo(h + x * h, h + y * h);
      else g.lineTo(h + x * h, h + y * h);
    });
    g.stroke();
  };
  path(
    [
      [-0.85, -0.2],
      [-0.4, 0.15],
      [-0.1, -0.25],
      [0.25, 0.2],
      [0.5, -0.05],
      [0.88, 0.25],
    ],
    6,
  );
  path(
    [
      [-0.1, -0.25],
      [0.05, -0.55],
      [0.3, -0.7],
    ],
    4,
  );
  g.restore();
};

/** A crackling corona: a blue rim, a halo and filaments that jump to new places. */
const LIGHTNING_FRAG = /* glsl */ `
${AURA_HEAD}
void main() {
  ${AURA_SHAPE}
  float t = floor(uTime * 17.0);
  float n = fbm(vec3(q * 2.2 + uSeed, t * 0.37));
  float r = 1.0 - abs(2.0 * fbm(vec3(q * 1.5 + uSeed * 2.0, t * 0.53)) - 1.0);
  float fil = pow(r, 16.0) * smoothstep(2.5, 1.1, d) * smoothstep(0.8, 1.0, d);
  float rim = exp(-pow((d - 1.0) / 0.22, 2.0));
  float halo = exp(-max(d - 0.9, 0.0) * 1.7) * (0.55 + 0.45 * n);
  vec3 col = mix(vec3(0.22, 0.42, 1.0), vec3(0.88, 0.95, 1.0), clamp(fil * 1.4 + rim * 0.35, 0.0, 1.0));
  float a = (rim * 0.5 + halo * 0.28 + fil * 1.3) * uAmp;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

// ---- Bolts: glowing ribbons along jagged paths (shared with thunder's in-cloud forks). ----

/** Points per ribbon (a 2-point path after 4 subdivisions). */
export const BOLT_POINTS = 17;

const BOLT_VERT = /* glsl */ `
attribute vec2 aUv;
attribute float aI;
attribute float aK;
varying vec2 vUv;
varying float vI;
varying float vK;
void main() {
  vUv = aUv;
  vI = aI;
  vK = aK;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BOLT_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vI;
varying float vK;
void main() {
  vec3 blue = vec3(0.32, 0.55, 1.0);
  if (vK < 0.5) {
    float v = abs(vUv.x);
    float core = 1.0 - smoothstep(0.12, 0.36, v);
    float halo = exp(-v * v * 3.2) * (1.0 - v);
    vec3 col = mix(blue, vec3(1.0), core);
    gl_FragColor = vec4(col, clamp((core + halo * 0.95) * vI, 0.0, 1.0));
  } else {
    float d = length(vUv);
    float a = exp(-d * d * 4.0) * max(0.0, 1.0 - d);
    vec3 col = mix(blue, vec3(1.0), exp(-d * d * 9.0));
    gl_FragColor = vec4(col, clamp(a * vI, 0.0, 1.0));
  }
}`;

export interface Bolts {
  mesh: Mesh;
  /** Start a frame's drawing. */
  begin(): void;
  /**
   * A ribbon along `pts` (flat x, z pairs, ≤ BOLT_POINTS) at height `y`: `w0` wide at its start,
   * `w1` at its end (world units), lit up to `reveal` (0–1) of its length.
   */
  ribbon(
    pts: readonly number[],
    y: number,
    w0: number,
    w1: number,
    i: number,
    reveal?: number,
  ): void;
  /** A soft flash of radius `r` at x, y, z. */
  disc(x: number, y: number, z: number, r: number, i: number): void;
  /** Finish the frame: unused slots are emptied. */
  end(): void;
  dispose(): void;
}

/** A bolt layer with room for `slots` ribbons and `discs` flashes: one draw. */
export function bolts(slots: number, discs: number): Bolts {
  const rv = BOLT_POINTS * 2;
  const verts = slots * rv + discs * 4;
  const pos = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const it = new Float32Array(verts);
  const kind = new Float32Array(verts);
  const index: number[] = [];
  for (let s = 0; s < slots; s++) {
    const b = s * rv;
    for (let i = 0; i < BOLT_POINTS - 1; i++) {
      const v = b + i * 2;
      index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  for (let k = 0; k < discs; k++) {
    const v = slots * rv + k * 4;
    index.push(v, v + 1, v + 2, v, v + 2, v + 3);
    kind.fill(1, v, v + 4);
    uv.set([-1, -1, 1, -1, 1, 1, -1, 1], v * 2);
  }
  const geometry = new BufferGeometry();
  const aPos = new Float32BufferAttribute(pos, 3);
  const aUv = new Float32BufferAttribute(uv, 2);
  const aI = new Float32BufferAttribute(it, 1);
  geometry.setAttribute("position", aPos);
  geometry.setAttribute("aUv", aUv);
  geometry.setAttribute("aI", aI);
  geometry.setAttribute("aK", new Float32BufferAttribute(kind, 1));
  geometry.setIndex(index);
  const material = new ShaderMaterial({
    vertexShader: BOLT_VERT,
    fragmentShader: BOLT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  // The arrays the attributes hold (three keeps the one given).
  const P = aPos.array;
  const U = aUv.array;
  const I = aI.array;
  let used = 0;
  let usedBefore = 0;
  let discUsed = 0;
  let discBefore = 0;

  return {
    mesh,
    begin() {
      used = 0;
      discUsed = 0;
    },
    ribbon(pts, y, w0, w1, i, reveal = 1) {
      if (used >= slots) return;
      const n = Math.min(BOLT_POINTS, pts.length / 2);
      if (n < 2) return;
      const b = used * rv;
      used++;
      for (let k = 0; k < BOLT_POINTS; k++) {
        const j = Math.min(k, n - 1);
        const a = Math.max(0, j - 1);
        const c = Math.min(n - 1, j + 1);
        const x = pts[j * 2] as number;
        const z = pts[j * 2 + 1] as number;
        let tx = (pts[c * 2] as number) - (pts[a * 2] as number);
        let tz = (pts[c * 2 + 1] as number) - (pts[a * 2 + 1] as number);
        const len = Math.hypot(tx, tz) || 1;
        tx /= len;
        tz /= len;
        const s = j / (n - 1);
        const hw = ((w0 + (w1 - w0) * s) / 2) * (k < n ? 1 : 0);
        const lit = k < n ? i * Math.max(0, Math.min(1, (reveal - s) * 8 + 1)) : 0;
        const v = b + k * 2;
        P.set([x - tz * hw, y, z + tx * hw, x + tz * hw, y, z - tx * hw], v * 3);
        U.set([-1, 0, 1, 0], v * 2);
        I[v] = lit;
        I[v + 1] = lit;
      }
    },
    disc(x, y, z, r, i) {
      if (discUsed >= discs) return;
      const v = slots * rv + discUsed * 4;
      discUsed++;
      P.set([x - r, y, z - r, x + r, y, z - r, x + r, y, z + r, x - r, y, z + r], v * 3);
      I.fill(i, v, v + 4);
    },
    end() {
      if (used < usedBefore) {
        P.fill(0, used * rv * 3, usedBefore * rv * 3);
        I.fill(0, used * rv, usedBefore * rv);
      }
      if (discUsed < discBefore) {
        const at = slots * rv;
        P.fill(0, (at + discUsed * 4) * 3, (at + discBefore * 4) * 3);
        I.fill(0, at + discUsed * 4, at + discBefore * 4);
      }
      usedBefore = used;
      discBefore = discUsed;
      aPos.needsUpdate = true;
      aUv.needsUpdate = true;
      aI.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** A seeded generator for one die (`k`) in one time slice (`slice`). */
export const sliceRand = (seed: number, k: number, slice: number) =>
  prng((seed ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(slice + 7, 0x85ebca6b)) >>> 0);

/**
 * A jagged path: each segment of `base` (flat x, z pairs) split `levels` times, the midpoint
 * pushed sideways by up to `rough` × the segment's length.
 */
export function jag(base: readonly number[], levels: number, rough: number, rand: () => number) {
  let pts = [...base];
  for (let l = 0; l < levels; l++) {
    const next: number[] = [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i] as number;
      const az = pts[i + 1] as number;
      const bx = pts[i + 2] as number;
      const bz = pts[i + 3] as number;
      const off = (rand() * 2 - 1) * rough;
      next.push(ax, az, (ax + bx) / 2 - (bz - az) * off, (az + bz) / 2 + (bx - ax) * off);
    }
    next.push(pts[pts.length - 2] as number, pts[pts.length - 1] as number);
    pts = next;
  }
  return pts;
}

/** A fork off `pts` at a random point past its first quarter: a shorter, rougher path. */
function fork(pts: readonly number[], rand: () => number, reach: number): number[] {
  const n = pts.length / 2;
  const j = Math.floor(n * (0.25 + rand() * 0.5));
  const x = pts[j * 2] as number;
  const z = pts[j * 2 + 1] as number;
  const ex = pts[pts.length - 2] as number;
  const ez = pts[pts.length - 1] as number;
  const ang = Math.atan2(ez - z, ex - x) + (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.55);
  const len = Math.hypot(ex - x, ez - z) * reach * (0.6 + rand() * 0.5);
  return jag([x, z, x + Math.cos(ang) * len, z + Math.sin(ang) * len], 3, 0.32, rand);
}

/** Bolt flicker in flight: new shapes this often per second. */
const SLICES_HZ = 15;
const STRIKE_Y = 3;
const FLOOR_Y = 0.1;

const lightningExtra: RichKindDef["extra"] = (dice, seed) => {
  const share = budgetScale(dice.length);
  const arcs = Math.max(1, Math.round(3 * share));
  const forks = Math.max(2, Math.round(5 * share));
  const perDie = Math.max(arcs * 2 + 2, 3 + forks * 2);
  const layer = bolts(dice.length * perDie, dice.length);
  const object = new Group();
  object.add(layer.mesh);

  /** Arcs crawling round die `k` and leaping off it. */
  const flight = (k: number, slice: number, amp: number, u: number) => {
    const d = dice[k];
    if (!d) return;
    const rand = sliceRand(seed, k, slice);
    if (rand() < 0.12) return; // a dark beat: the crackle flickers
    const { x, y, z } = d.mesh.position;
    const r = d.radius;
    const top = y + r * 1.3;
    // Bright at a new shape, then dimming: the flicker.
    const lit = amp * (1.15 - 0.55 * u);
    const count = 1 + Math.floor(rand() * arcs);
    for (let a = 0; a < count; a++) {
      const a0 = rand() * Math.PI * 2;
      let pts: number[];
      if (rand() < 0.55) {
        // Round the rim.
        const span = 0.9 + rand() * 1.4;
        const rr = r * (1.0 + rand() * 0.2);
        const base: number[] = [];
        for (let s = 0; s <= 4; s++) {
          const ang = a0 + (span * s) / 4;
          const out = rr * (1 + (s % 2) * 0.12 * (rand() * 2 - 1));
          base.push(x + Math.cos(ang) * out, z + Math.sin(ang) * out);
        }
        pts = jag(base, 2, 0.3, rand);
      } else {
        // Off the die, outward.
        const from = r * 0.8;
        const to = r * (2.2 + rand() * 1.6);
        const bend = a0 + (rand() * 2 - 1) * 0.5;
        pts = jag(
          [
            x + Math.cos(a0) * from,
            z + Math.sin(a0) * from,
            x + Math.cos(bend) * to,
            z + Math.sin(bend) * to,
          ],
          4,
          0.28,
          rand,
        );
        if (rand() < 0.6) layer.ribbon(fork(pts, rand, 0.5), top, r * 0.22, r * 0.08, lit * 0.7);
      }
      layer.ribbon(pts, top, r * 0.4, r * 0.18, lit);
    }
    // Leaping to the next lightning die when it rolls close.
    const o = dice[k + 1];
    if (o && rand() < 0.45) {
      const p = o.mesh.position;
      const gap = Math.hypot(p.x - x, p.z - z);
      if (gap < r * 9 && gap > r * 1.5) {
        const ux = (p.x - x) / gap;
        const uz = (p.z - z) / gap;
        const pts = jag(
          [
            x + ux * r * 0.8,
            z + uz * r * 0.8,
            p.x - ux * o.radius * 0.8,
            p.z - uz * o.radius * 0.8,
          ],
          4,
          0.22,
          rand,
        );
        layer.ribbon(pts, top, r * 0.42, r * 0.42, lit);
        layer.ribbon(fork(pts, rand, 0.4), top, r * 0.22, r * 0.08, lit * 0.6);
      }
    }
  };

  /** Strike shapes: from where, set once at landing per die. */
  const skyAt: number[] = dice.map((_, k) => {
    const rand = sliceRand(seed, k, 9999);
    return -Math.PI / 2 + (rand() * 2 - 1) * 0.7;
  });

  /** The strike on die `k`, `s` seconds after rest. */
  const strike = (k: number, s: number) => {
    const d = dice[k];
    if (!d) return;
    const { x, y, z } = d.mesh.position;
    const r = d.radius;
    // Strike, re-strike, a last flicker; then crackle on the floor fading out.
    const beats: readonly [number, number, number][] = [
      [0, 0.13, 1.25],
      [0.16, 0.27, 1],
      [0.31, 0.37, 0.7],
    ];
    const beat = beats.findIndex(([a, b]) => s >= a && s < b);
    const fade = s < 0.37 ? 1 : Math.max(0, 1 - (s - 0.37) / 0.23);
    if (fade <= 0) return;
    const rand = sliceRand(seed, k, 1000 + Math.max(0, beat) + (beat < 0 ? Math.floor(s * 20) : 0));
    if (beat >= 0) {
      const [a, , i] = beats[beat] as [number, number, number];
      const reveal = beat === 0 ? Math.min(1, (s - a) / 0.05) : 1;
      const ang = (skyAt[k] as number) + (rand() * 2 - 1) * 0.08;
      const far = r * (8 + rand() * 2);
      const main = jag([x + Math.cos(ang) * far, z + Math.sin(ang) * far, x, z], 4, 0.2, rand);
      layer.ribbon(main, STRIKE_Y + y, r * 0.5, r * 1.05, i, reveal);
      if (reveal >= 1) {
        layer.ribbon(fork(main, rand, 0.55), STRIKE_Y + y, r * 0.3, r * 0.09, i * 0.7);
        layer.ribbon(fork(main, rand, 0.4), STRIKE_Y + y, r * 0.24, r * 0.07, i * 0.6);
      }
      const flash = (beat === 0 ? 1 : 0.6) * Math.max(0, 1 - (s - a) / 0.12);
      layer.disc(
        x,
        STRIKE_Y + y,
        z,
        r * (3.5 + 1.5 * flash),
        Math.min(0.8, 0.7 * i * flash + 0.15),
      );
    }
    // Forks running across the floor from the impact.
    if (beat < 0 && rand() < 0.3) return;
    const n = Math.max(2, Math.round(forks * (beat < 0 ? 0.5 : 1)));
    for (let f = 0; f < n; f++) {
      const a0 = ((f + rand() * 0.6) / n) * Math.PI * 2;
      const reach = r * (2.4 + rand() * 2.2) * (beat === 0 ? Math.min(1, s / 0.06 + 0.3) : 1);
      const pts = jag(
        [
          x + Math.cos(a0) * r * 0.6,
          z + Math.sin(a0) * r * 0.6,
          x + Math.cos(a0) * reach,
          z + Math.sin(a0) * reach,
        ],
        4,
        0.3,
        rand,
      );
      const lit = fade * (beat < 0 ? 0.55 : 0.9);
      layer.ribbon(pts, FLOOR_Y, r * 0.36, r * 0.08, lit);
      if (rand() < 0.5) layer.ribbon(fork(pts, rand, 0.5), FLOOR_Y, r * 0.18, r * 0.05, lit * 0.7);
    }
  };

  const extra: RichExtra = {
    object,
    update(t, progress, _unit, sinceRest) {
      layer.begin();
      if (sinceRest === null) {
        const amp = Math.min(1, progress / 0.06);
        const slice = Math.floor(t * SLICES_HZ);
        const u = t * SLICES_HZ - slice;
        for (let k = 0; k < dice.length; k++) flight(k, slice + k * 3, amp, u);
      } else {
        for (let k = 0; k < dice.length; k++) strike(k, sinceRest);
      }
      layer.end();
    },
    land() {},
    dispose() {
      layer.dispose();
    },
  };
  return extra;
};

export const lightning: RichKindDef = {
  preset: LIGHTNING,
  tiles: { "lightning-zap": zap },
  aura: { frag: LIGHTNING_FRAG, size: 2.8 },
  whileRolling: true,
  extra: lightningExtra,
};
