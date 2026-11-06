// FR-DICEX-106: necrotic dice (DM direction, 2026-11-06): dark skulls with violet light in their
// eyes circle the die (the skull shared with poison, skull.ts); black smoke is drawn in toward it,
// purple wisps and sinking motes; a dark tendril rim; the die glows violet. On landing a ring of
// black smoke bursts out and the skulls fly off.
import type { RichPreset } from "../fx-sim";
import type { RichKindDef, TileDraw } from "./kind";
import { AURA_HEAD, AURA_SHAPE } from "./shaders";
import { skullExtra } from "./skull";
import { soft } from "./tiles";

const NECROTIC: RichPreset = {
  species: [
    {
      // Black smoke, drawn in toward the die: life drained into it.
      tile: "necrotic-wisp",
      additive: false,
      life: [0.6, 1],
      size: [1.6, 0.7],
      speed: [-1.4, -0.6],
      drag: 0.6,
      drift: [0, 0],
      spin: 2,
      from: [1.4, 2.1],
      lift: 0.4,
      ramp: [
        [0, 0.06, 0.02, 0.1, 0],
        [0.3, 0.07, 0.02, 0.12, 0.7],
        [0.8, 0.12, 0.03, 0.2, 0.55],
        [1, 0.15, 0.04, 0.25, 0],
      ],
      twinkle: 0,
    },
    {
      // Purple wisps lit from within.
      tile: "necrotic-wisp",
      additive: true,
      life: [0.5, 0.9],
      size: [1.1, 0.5],
      speed: [-1.2, -0.4],
      drag: 0.6,
      drift: [0, 0],
      spin: 2.5,
      from: [1.2, 1.9],
      lift: 0.45,
      ramp: [
        [0, 0.55, 0.2, 0.9, 0],
        [0.35, 0.6, 0.25, 1, 0.5],
        [1, 0.3, 0.05, 0.6, 0],
      ],
      twinkle: 0,
    },
    {
      // Motes sinking off the die.
      tile: "dot",
      additive: true,
      life: [0.7, 1.2],
      size: [0.18, 0.06],
      speed: [0.4, 1.2],
      drag: 1.5,
      drift: [0, 0.9],
      spin: 0,
      from: [0.6, 1.1],
      lift: 1.2,
      ramp: [
        [0, 0.85, 0.6, 1, 1],
        [0.6, 0.6, 0.3, 1, 0.8],
        [1, 0.35, 0.1, 0.7, 0],
      ],
      twinkle: 7,
    },
    {
      // Dark pool on the floor, under the die.
      tile: "dot",
      additive: false,
      life: [0.9, 1.4],
      size: [1.4, 2.8],
      speed: [0.1, 0.4],
      drag: 1,
      drift: [0, 0.3],
      spin: 0,
      from: [0.2, 0.7],
      lift: null,
      ramp: [
        [0, 0.05, 0.01, 0.08, 0],
        [0.3, 0.06, 0.01, 0.1, 0.45],
        [1, 0.08, 0.02, 0.14, 0],
      ],
      twinkle: 0,
    },
    {
      // Black smoke, only when the die lands: a ring bursting out.
      tile: "necrotic-wisp",
      additive: false,
      life: [0.35, 0.6],
      size: [0.9, 2],
      speed: [1.5, 2.5],
      drag: 3,
      drift: [0, 0],
      spin: 2,
      from: [0.7, 1],
      lift: null,
      ramp: [
        [0, 0.1, 0.02, 0.16, 0.8],
        [1, 0.1, 0.02, 0.16, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 30, burst: 0, burstSpeed: 1 },
    { species: 1, rate: 22, burst: 12, burstSpeed: -2 },
    { species: 2, rate: 18, burst: 24, burstSpeed: 2 },
    { species: 3, rate: 8, burst: 8, burstSpeed: 2 },
    { species: 4, rate: 0, burst: 30, burstSpeed: 1 },
  ],
  glow: {
    emissive: 0x7a22d0,
    range: [0.2, 0.42],
    hz: 2.2,
    tint: { color: 0x2a1a3a, amount: 0.3 },
  },
};

/** A wisp: a curved, tapering streak of smoke. */
const wisp: TileDraw = (g, px) => {
  const h = px / 2;
  for (let k = 0; k <= 10; k++) {
    const u = k / 10;
    const a = -0.9 + u * 1.8;
    const x = h + Math.sin(a) * h * 0.55;
    const y = h - Math.cos(a) * h * 0.25 + h * 0.15;
    soft(g, x, y, h * (0.12 + 0.22 * Math.sin(u * Math.PI)), 0.75);
  }
};

/** A rim of dark violet tendrils curling round the die. */
const NECROTIC_FRAG = /* glsl */ `
${AURA_HEAD}
void main() {
  ${AURA_SHAPE}
  float ang = atan(q.y, q.x);
  // Tendrils: a spiral, turning, broken up by noise.
  float sp = sin(ang * 5.0 + d * 3.2 - uTime * 3.0);
  float n = fbm(vec3(dn * 1.8 + uSeed, d * 0.9 - uTime * 0.8));
  float band = smoothstep(0.4, 1.0, sp * 0.5 + 0.5 + (n - 0.5) * 0.9);
  float reach = 0.6 + 1.0 * n;
  float fall = (1.0 - smoothstep(0.0, reach, d - 0.85)) * smoothstep(0.65, 0.95, d);
  float rim = exp(-pow((d - 0.98) / 0.16, 2.0));
  vec3 col = mix(vec3(0.3, 0.05, 0.5), vec3(0.75, 0.4, 1.0), clamp(rim * 0.6 + band * 0.4, 0.0, 1.0));
  float a = (rim * 0.6 + band * fall * 0.7) * uAmp;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

export const necrotic: RichKindDef = {
  preset: NECROTIC,
  tiles: { "necrotic-wisp": wisp },
  aura: { frag: NECROTIC_FRAG, size: 2.8 },
  whileRolling: true,
  extra: (dice, seed) =>
    skullExtra(dice, seed, {
      color: 0x2a1638,
      halo: 0xc070ff,
      per: 3,
      motion: "orbit",
      size: 1.3,
    }),
};
