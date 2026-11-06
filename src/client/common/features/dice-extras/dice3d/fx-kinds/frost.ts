// FR-DICEX-106: cold dice, kind "frost" (DM accepted, 2026-11-06): an icy rim with frost veins
// and mist, the die frosts over and glows, snowflakes, glitter and floor mist; ice shards flung out
// on landing.
import type { RichPreset } from "../fx-sim";
import type { RichKindDef, TileDraw } from "./kind";
import { AURA_HEAD, AURA_SHAPE } from "./shaders";

const FROST: RichPreset = {
  species: [
    {
      // Cold mist rolling along the floor.
      tile: "dot",
      additive: false,
      life: [0.9, 1.5],
      size: [1.2, 3.2],
      speed: [0.2, 0.6],
      drag: 1,
      drift: [0, 0.25],
      spin: 0,
      from: [0.3, 0.9],
      lift: null,
      ramp: [
        [0, 0.62, 0.84, 1, 0],
        [0.25, 0.66, 0.86, 1, 0.3],
        [1, 0.75, 0.9, 1, 0],
      ],
      twinkle: 0,
    },
    {
      // Snowflakes, slowly turning and drifting down.
      tile: "flake",
      additive: false,
      life: [1, 1.7],
      size: [0.5, 0.32],
      speed: [0.4, 1.2],
      drag: 1.2,
      drift: [0, 0.5],
      spin: 2.5,
      from: [0.7, 1.2],
      lift: 1.4,
      ramp: [
        [0, 0.85, 0.95, 1, 0],
        [0.15, 0.85, 0.95, 1, 0.95],
        [0.7, 0.75, 0.9, 1, 0.8],
        [1, 0.7, 0.88, 1, 0],
      ],
      twinkle: 0,
    },
    {
      // Ice glitter: tiny twinkling stars.
      tile: "star",
      additive: true,
      life: [0.4, 0.9],
      size: [0.4, 0.12],
      speed: [0.3, 1.5],
      drag: 2,
      drift: [0, 0.2],
      spin: 1,
      from: [0.6, 1.1],
      lift: 1.5,
      ramp: [
        [0, 1, 1, 1, 1],
        [0.5, 0.7, 0.92, 1, 0.9],
        [1, 0.45, 0.75, 1, 0],
      ],
      twinkle: 10,
    },
    {
      // Ice shards: only when the die lands, flung out fast.
      tile: "star",
      additive: true,
      life: [0.3, 0.6],
      size: [0.55, 0.15],
      speed: [2, 4],
      drag: 3,
      drift: [0, 0],
      spin: 4,
      from: [0.8, 1],
      lift: 1.2,
      ramp: [
        [0, 1, 1, 1, 1],
        [1, 0.5, 0.8, 1, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 14, burst: 14, burstSpeed: 4 },
    { species: 1, rate: 16, burst: 14, burstSpeed: 1.8 },
    { species: 2, rate: 40, burst: 30, burstSpeed: 2.5 },
    { species: 3, rate: 0, burst: 26, burstSpeed: 1 },
  ],
  glow: {
    emissive: 0x7fd4ff,
    range: [0.25, 0.45],
    hz: 1.5,
    tint: { color: 0x9ed8ff, amount: 0.45 },
  },
};

/** A snowflake: six branched arms with a soft glow. */
const flake: TileDraw = (g, px) => {
  const h = px / 2;
  g.save();
  g.translate(h, h);
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineCap = "round";
  g.shadowColor = "rgba(255,255,255,0.9)";
  g.shadowBlur = 10;
  for (let k = 0; k < 6; k++) {
    g.save();
    g.rotate((k * Math.PI) / 3);
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -h * 0.82);
    g.stroke();
    g.lineWidth = 5;
    for (const [at, len] of [
      [0.38, 0.24],
      [0.6, 0.18],
    ] as const) {
      g.beginPath();
      g.moveTo(0, -h * at);
      g.lineTo(h * len, -h * (at + len));
      g.moveTo(0, -h * at);
      g.lineTo(-h * len, -h * (at + len));
      g.stroke();
    }
    g.restore();
  }
  g.restore();
};

/** An icy rim with frost veins and mist. */
const FROST_FRAG = /* glsl */ `
${AURA_HEAD}
void main() {
  ${AURA_SHAPE}
  float n = fbm(vec3(q * 1.8 + uSeed, uTime * 0.35));
  // Frost veins: thin, faint and slow (bright and sharp reads as lightning).
  float v = 1.0 - abs(2.0 * fbm(vec3(q * 2.6 - uSeed, uTime * 0.15)) - 1.0);
  v = pow(v, 10.0) * 0.45;
  float rim = exp(-pow((d - 1.0) / 0.3, 2.0));
  float mist = exp(-max(d - 0.85, 0.0) * 1.7) * (0.3 + 0.7 * n);
  float a = (rim * 0.65 + mist * 0.4 + v * mist * 1.1) * uAmp;
  vec3 col = mix(vec3(0.36, 0.7, 1.0), vec3(0.85, 0.95, 1.0), clamp(rim * 0.5 + v, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

export const frost: RichKindDef = {
  preset: FROST,
  tiles: { flake },
  aura: { frag: FROST_FRAG, size: 2.8 },
  whileRolling: true,
};
