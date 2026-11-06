// FR-DICEX-106: fire dice (DM accepted, 2026-11-06): flames licking off the die all round,
// embers and smoke; a flame-tongue aura; the die glows; flames and embers flung out on landing.
import type { RichPreset } from "../fx-sim";
import type { RichKindDef, TileDraw } from "./kind";
import { AURA_HEAD, AURA_SHAPE } from "./shaders";
import { soft } from "./tiles";

const FIRE: RichPreset = {
  species: [
    {
      // Flames: licking off the die, left behind as a burning trail.
      tile: "flame",
      additive: true,
      life: [0.3, 0.55],
      size: [1.1, 1.9],
      speed: [0.4, 1.4],
      drag: 2.5,
      drift: [0, -1.4],
      spin: 3,
      from: [0.4, 0.95],
      lift: 0,
      ramp: [
        [0, 1, 0.95, 0.75, 0],
        [0.12, 1, 0.82, 0.4, 0.95],
        [0.45, 1, 0.45, 0.08, 0.75],
        [0.8, 0.7, 0.12, 0.02, 0.3],
        [1, 0.4, 0.05, 0, 0],
      ],
      twinkle: 0,
    },
    {
      // Embers: hot sparks thrown off, rising and cooling.
      tile: "dot",
      additive: true,
      life: [0.6, 1.3],
      size: [0.24, 0.08],
      speed: [1.2, 3.8],
      drag: 1.3,
      drift: [0, -1.8],
      spin: 0,
      from: [0.5, 1],
      lift: 1.5,
      ramp: [
        [0, 1, 1, 0.85, 1],
        [0.3, 1, 0.72, 0.25, 1],
        [0.75, 1, 0.35, 0.05, 0.8],
        [1, 0.6, 0.1, 0, 0],
      ],
      twinkle: 11,
    },
    {
      // Smoke: on the floor, under the dice.
      tile: "flame",
      additive: false,
      life: [0.9, 1.4],
      size: [1, 2.8],
      speed: [0.2, 0.6],
      drag: 1,
      drift: [0, -0.7],
      spin: 1,
      from: [0.3, 0.8],
      lift: null,
      ramp: [
        [0, 0.24, 0.2, 0.18, 0],
        [0.25, 0.22, 0.19, 0.17, 0.3],
        [1, 0.2, 0.18, 0.17, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 95, burst: 44, burstSpeed: 3 },
    { species: 1, rate: 26, burst: 38, burstSpeed: 2 },
    { species: 2, rate: 10, burst: 10, burstSpeed: 2.5 },
  ],
  glow: { emissive: 0xff5a10, range: [0.35, 0.75], hz: 9 },
};

/** A ragged flame puff: overlapping blobs. */
const flame: TileDraw = (g, px) => {
  const h = px / 2;
  const blobs = [
    [0, 0, 0.62, 0.9],
    [0.22, -0.18, 0.4, 0.6],
    [-0.24, -0.1, 0.38, 0.55],
    [0.08, 0.26, 0.36, 0.5],
    [-0.15, 0.22, 0.3, 0.45],
    [0.28, 0.12, 0.28, 0.45],
  ] as const;
  for (const [x, y, r, a] of blobs) soft(g, h + x * h, h + y * h, r * h, a);
};

/** Flame tongues all round the die. */
const FIRE_FRAG = /* glsl */ `
${AURA_HEAD}
void main() {
  ${AURA_SHAPE}
  float n = fbm(vec3(dn * 2.4 + uSeed, d * 1.2 - uTime * 3.4));
  float m = fbm(vec3(q * 1.4 + uSeed * 3.0, uTime * 1.6));
  float reach = 0.25 + 1.7 * n * (0.6 + 0.8 * m);
  float heat = 1.0 - smoothstep(0.0, reach, d - 0.8);
  vec3 col = mix(vec3(0.6, 0.06, 0.0), vec3(1.0, 0.42, 0.04), smoothstep(0.05, 0.5, heat));
  col = mix(col, vec3(1.0, 0.86, 0.5), smoothstep(0.6, 0.98, heat));
  float a = smoothstep(0.0, 0.4, heat) * uAmp;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

export const fire: RichKindDef = {
  preset: FIRE,
  tiles: { flame },
  aura: { frag: FIRE_FRAG, size: 3.2 },
  whileRolling: true,
};
