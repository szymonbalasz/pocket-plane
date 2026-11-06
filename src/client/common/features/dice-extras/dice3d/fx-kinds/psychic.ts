// FR-DICEX-106: psychic dice (DM direction, 2026-11-06): several small purple pings / ripples.
// Many little rings ripple out all round the die, over a violet haze with interference waves;
// the die throbs purple. Landing: a wave of pings flung out and two wide ripples.
import type { RichPreset } from "../fx-sim";
import type { RichKindDef, TileDraw } from "./kind";
import { AURA_HEAD, AURA_SHAPE } from "./shaders";

const PSYCHIC: RichPreset = {
  species: [
    {
      // Pings: small rings rippling out round the die.
      tile: "psychic-ping",
      additive: true,
      life: [0.45, 0.8],
      size: [0.25, 1.6],
      speed: [0.1, 0.45],
      drag: 1.5,
      drift: [0, 0],
      spin: 0,
      from: [1.05, 2.1],
      lift: 0.5,
      ramp: [
        [0, 1, 0.75, 1, 0],
        [0.1, 0.95, 0.55, 1, 1],
        [0.55, 0.72, 0.32, 1, 0.65],
        [1, 0.5, 0.15, 0.9, 0],
      ],
      twinkle: 0,
    },
    {
      // Motes of thought: small pink-violet sparks.
      tile: "dot",
      additive: true,
      life: [0.4, 0.9],
      size: [0.22, 0.08],
      speed: [0.3, 1.1],
      drag: 1.8,
      drift: [0, 0],
      spin: 0,
      from: [0.9, 1.5],
      lift: 1.2,
      ramp: [
        [0, 1, 0.8, 1, 1],
        [0.5, 0.85, 0.45, 1, 0.85],
        [1, 0.55, 0.2, 0.95, 0],
      ],
      twinkle: 8,
    },
    {
      // Landing: two wide ripples from the die.
      tile: "psychic-ping",
      additive: true,
      life: [0.35, 0.6],
      size: [2.2, 7.5],
      speed: [0, 0],
      drag: 0,
      drift: [0, 0],
      spin: 0,
      from: [0, 0],
      lift: 0.4,
      ramp: [
        [0, 1, 0.8, 1, 1],
        [0.5, 0.8, 0.4, 1, 0.55],
        [1, 0.5, 0.15, 0.9, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 42, burst: 24, burstSpeed: 5 },
    { species: 1, rate: 16, burst: 18, burstSpeed: 3 },
    { species: 2, rate: 0, burst: 2, burstSpeed: 1 },
  ],
  glow: { emissive: 0xa23cff, range: [0.2, 0.55], hz: 5 },
};

/** A ping: a crisp glowing ring with a fainter echo inside it. */
const psychicPing: TileDraw = (g, px) => {
  const h = px / 2;
  g.save();
  g.strokeStyle = "rgba(255,255,255,1)";
  g.shadowColor = "rgba(255,255,255,1)";
  g.shadowBlur = 12;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(h, h, h * 0.8, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.45)";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(h, h, h * 0.52, 0, Math.PI * 2);
  g.stroke();
  g.restore();
};

/** A violet haze with interference ripples from two wandering centres. */
const PSYCHIC_FRAG = /* glsl */ `
${AURA_HEAD}
void main() {
  ${AURA_SHAPE}
  float n = fbm(vec3(q * 1.3 + uSeed, uTime * 0.7));
  float haze = exp(-max(d - 0.9, 0.0) * 1.5) * (0.25 + 0.75 * n);
  vec2 c1 = 0.6 * vec2(sin(uTime * 1.7 + uSeed), cos(uTime * 1.3 + uSeed));
  float w1 = sin(length(q - c1) * 8.0 - uTime * 10.0);
  float w2 = sin(length(q + c1) * 8.0 - uTime * 10.0);
  float waves = pow(max(0.0, (w1 + w2) * 0.5), 4.0);
  float fall = smoothstep(uHalf, 1.0, d) * smoothstep(0.85, 1.1, d);
  float alpha = (haze * 0.4 + waves * fall * (0.35 + 0.5 * n)) * uAmp;
  vec3 col = mix(vec3(0.5, 0.12, 0.9), vec3(1.0, 0.6, 1.0), clamp(waves * 0.8, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

export const psychic: RichKindDef = {
  preset: PSYCHIC,
  tiles: { "psychic-ping": psychicPing },
  aura: { frag: PSYCHIC_FRAG, size: 3 },
  whileRolling: true,
};
