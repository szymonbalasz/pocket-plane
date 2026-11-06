// FR-DICEX-106: radiant dice (DM direction, 2026-11-06): a golden sunburst. Rays radiate from
// the die and slowly turn over a warm glow, gold motes rise and glints twinkle; the die shines gold.
// Landing: a bright sunburst flashes out from the die with a spray of sparks.
import type { RichPreset } from "../fx-sim";
import type { RichKindDef, TileDraw } from "./kind";
import { AURA_HEAD, AURA_SHAPE } from "./shaders";
import { soft } from "./tiles";

const RADIANT: RichPreset = {
  species: [
    {
      // Gold motes rising off the die.
      tile: "dot",
      additive: true,
      life: [0.6, 1.1],
      size: [0.26, 0.08],
      speed: [0.3, 1.2],
      drag: 1.4,
      drift: [0, -1.2],
      spin: 0,
      from: [0.8, 1.4],
      lift: 1.3,
      ramp: [
        [0, 1, 0.98, 0.85, 1],
        [0.4, 1, 0.82, 0.35, 0.9],
        [1, 1, 0.6, 0.1, 0],
      ],
      twinkle: 7,
    },
    {
      // Glints in the light.
      tile: "star",
      additive: true,
      life: [0.35, 0.7],
      size: [0.5, 0.15],
      speed: [0.2, 0.9],
      drag: 2,
      drift: [0, -0.4],
      spin: 1.2,
      from: [1, 1.8],
      lift: 1.3,
      ramp: [
        [0, 1, 1, 0.9, 1],
        [1, 1, 0.75, 0.3, 0],
      ],
      twinkle: 10,
    },
    {
      // Landing: the sunburst flashing out from the die.
      tile: "radiant-sun",
      additive: true,
      life: [0.4, 0.55],
      size: [2.4, 8.5],
      speed: [0, 0],
      drag: 0,
      drift: [0, 0],
      spin: 0.8,
      from: [0, 0],
      lift: 0.4,
      ramp: [
        [0, 1, 1, 0.85, 1],
        [0.3, 1, 0.85, 0.4, 0.8],
        [1, 1, 0.55, 0.1, 0],
      ],
      twinkle: 0,
    },
    {
      // Landing: a white-gold flash round the die.
      tile: "dot",
      additive: true,
      life: [0.22, 0.3],
      size: [2.6, 5.5],
      speed: [0, 0],
      drag: 0,
      drift: [0, 0],
      spin: 0,
      from: [0, 0],
      lift: 0.4,
      ramp: [
        [0, 1, 1, 0.9, 0.9],
        [1, 1, 0.75, 0.3, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 30, burst: 26, burstSpeed: 3 },
    { species: 1, rate: 12, burst: 18, burstSpeed: 3.5 },
    { species: 2, rate: 0, burst: 2, burstSpeed: 1 },
    { species: 3, rate: 0, burst: 1, burstSpeed: 1 },
  ],
  glow: { emissive: 0xffaa2a, range: [0.3, 0.6], hz: 2.5 },
};

/** A sunburst: tapering rays round a soft core, long and short in turn. */
const radiantSun: TileDraw = (g, px) => {
  const h = px / 2;
  soft(g, h, h, h * 0.42, 0.85);
  g.save();
  g.translate(h, h);
  const rays = 16;
  for (let k = 0; k < rays; k++) {
    const long = k % 2 === 0;
    const len = h * (long ? 0.97 : 0.68);
    const w = h * (long ? 0.09 : 0.06);
    g.save();
    g.rotate((k * Math.PI * 2) / rays);
    const grad = g.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-w, 0);
    g.lineTo(0, -len);
    g.lineTo(w, 0);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.restore();
};

/** Golden rays radiating from the die, two sets turning opposite ways, over a warm glow. */
const RADIANT_FRAG = /* glsl */ `
${AURA_HEAD}
void main() {
  ${AURA_SHAPE}
  float ang = atan(q.y, q.x);
  float r1 = pow(0.5 + 0.5 * cos(ang * 12.0 + uTime * 0.9 + uSeed), 8.0);
  float r2 = pow(0.5 + 0.5 * cos(ang * 7.0 - uTime * 1.4 + uSeed * 2.0), 14.0);
  float len = 0.55 + 0.45 * fbm(vec3(dn * 2.5 + uSeed, uTime * 1.6));
  float reach = 1.0 + (uHalf - 1.0) * len;
  float rays = (r1 * 0.85 + r2 * 0.7) * (1.0 - smoothstep(1.0, reach, d));
  float core = exp(-max(d - 0.9, 0.0) * 2.4);
  float alpha = (rays * 0.8 + core * 0.55) * smoothstep(0.75, 1.0, d) * uAmp;
  vec3 col = mix(vec3(1.0, 0.6, 0.12), vec3(1.0, 0.95, 0.72), clamp(core + rays * 0.35, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

export const radiant: RichKindDef = {
  preset: RADIANT,
  tiles: { "radiant-sun": radiantSun },
  aura: { frag: RADIANT_FRAG, size: 3.4 },
  whileRolling: true,
};
