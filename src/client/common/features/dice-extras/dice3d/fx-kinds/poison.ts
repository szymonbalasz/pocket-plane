// FR-DICEX-106: poison dice (DM direction, 2026-11-06): thick yellow-green fumes rising off the
// die, with skulls rising in them (the skull shared with necrotic, skull.ts); a sickly haze round
// the die, spores; a gust of fumes and the skulls flung out on landing.
import type { RichPreset } from "../fx-sim";
import type { RichKindDef, TileDraw } from "./kind";
import { AURA_HEAD, AURA_SHAPE } from "./shaders";
import { skullExtra } from "./skull";
import { soft } from "./tiles";

const POISON: RichPreset = {
  species: [
    {
      // Fumes: thick, rolling up off the die.
      tile: "poison-fume",
      additive: false,
      life: [0.9, 1.4],
      size: [0.9, 2.8],
      speed: [0.2, 0.7],
      drag: 1.6,
      drift: [0, -2],
      spin: 1.2,
      from: [0.3, 0.9],
      lift: 0.3,
      ramp: [
        [0, 0.85, 0.95, 0.2, 0],
        [0.15, 0.78, 0.92, 0.16, 0.75],
        [0.6, 0.55, 0.75, 0.12, 0.5],
        [1, 0.4, 0.55, 0.08, 0],
      ],
      twinkle: 0,
    },
    {
      // A glow in the fumes, so they read on the dark.
      tile: "poison-fume",
      additive: true,
      life: [0.5, 0.9],
      size: [0.6, 1.7],
      speed: [0.2, 0.6],
      drag: 1.6,
      drift: [0, -1.3],
      spin: 1,
      from: [0.4, 0.9],
      lift: 0.35,
      ramp: [
        [0, 0.8, 1, 0.2, 0],
        [0.25, 0.65, 0.9, 0.12, 0.35],
        [1, 0.3, 0.5, 0.05, 0],
      ],
      twinkle: 0,
    },
    {
      // Spores: tiny yellow motes drifting up.
      tile: "dot",
      additive: true,
      life: [0.7, 1.3],
      size: [0.16, 0.08],
      speed: [0.4, 1.6],
      drag: 1.4,
      drift: [0, -1.1],
      spin: 0,
      from: [0.6, 1.1],
      lift: 1.3,
      ramp: [
        [0, 1, 1, 0.4, 1],
        [0.6, 0.8, 1, 0.2, 0.8],
        [1, 0.5, 0.8, 0.1, 0],
      ],
      twinkle: 6,
    },
    {
      // Haze on the floor, under the die.
      tile: "poison-fume",
      additive: false,
      life: [0.9, 1.4],
      size: [1.2, 3],
      speed: [0.2, 0.5],
      drag: 1,
      drift: [0, -0.5],
      spin: 0.6,
      from: [0.3, 0.8],
      lift: null,
      ramp: [
        [0, 0.6, 0.75, 0.15, 0],
        [0.3, 0.55, 0.7, 0.14, 0.28],
        [1, 0.45, 0.6, 0.1, 0],
      ],
      twinkle: 0,
    },
    {
      // A gust of fumes, only when the die lands: a ring blown out from its rim.
      tile: "poison-fume",
      additive: false,
      life: [0.4, 0.7],
      size: [1, 2.2],
      speed: [1.6, 2.6],
      drag: 2.5,
      drift: [0, -0.8],
      spin: 1.5,
      from: [0.95, 1.25],
      lift: 0.3,
      ramp: [
        [0, 0.85, 0.95, 0.2, 0.7],
        [1, 0.5, 0.7, 0.1, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 40, burst: 0, burstSpeed: 1 },
    { species: 1, rate: 18, burst: 0, burstSpeed: 1 },
    { species: 2, rate: 22, burst: 24, burstSpeed: 2 },
    { species: 3, rate: 9, burst: 10, burstSpeed: 3 },
    { species: 4, rate: 0, burst: 22, burstSpeed: 1 },
  ],
  glow: {
    emissive: 0xb8e02a,
    range: [0.12, 0.3],
    hz: 1.8,
  },
};

/** A billowing fume puff: soft lumps. */
const fume: TileDraw = (g, px) => {
  const h = px / 2;
  const lumps = [
    [0, 0.05, 0.6, 0.75],
    [-0.28, 0.1, 0.42, 0.6],
    [0.3, 0.08, 0.4, 0.6],
    [-0.1, -0.25, 0.42, 0.6],
    [0.18, -0.2, 0.36, 0.55],
    [0, 0.3, 0.38, 0.5],
  ] as const;
  for (const [x, y, r, a] of lumps) soft(g, h + x * h, h + y * h, r * h, a);
};

/** A sickly haze round the die, curling upward. */
const POISON_FRAG = /* glsl */ `
${AURA_HEAD}
void main() {
  ${AURA_SHAPE}
  // Rising: the noise scrolls up the screen (q.y down).
  float n = fbm(vec3(q * 1.3 + vec2(0.0, uTime * 1.1) + uSeed, uTime * 0.5));
  float m = fbm(vec3(q * 2.7 + vec2(0.0, uTime * 1.8) - uSeed, uTime * 0.8));
  // Taller above the die than below it.
  float up = clamp(-q.y / max(d, 1e-3), -1.0, 1.0);
  float reach = 0.9 + 0.9 * n + 0.5 * max(up, 0.0);
  float haze = (1.0 - smoothstep(0.0, reach, d - 0.85)) * smoothstep(0.6, 0.95, d);
  float wisp = smoothstep(0.55, 0.85, m) * haze;
  vec3 col = mix(vec3(0.35, 0.55, 0.05), vec3(0.85, 1.0, 0.3), wisp);
  float a = (haze * 0.45 + wisp * 0.5) * uAmp;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

export const poison: RichKindDef = {
  preset: POISON,
  tiles: { "poison-fume": fume },
  aura: { frag: POISON_FRAG, size: 2.9 },
  whileRolling: true,
  extra: (dice, seed) =>
    skullExtra(dice, seed, {
      color: 0xe4f7a8,
      halo: 0x9ae02a,
      per: 2,
      motion: "rise",
      size: 1.3,
    }),
};
