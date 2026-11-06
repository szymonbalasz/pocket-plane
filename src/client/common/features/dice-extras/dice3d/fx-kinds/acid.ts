// FR-DICEX-106: acid dice (DM direction, 2026-11-06): green acid bubbles swell and pop around the
// die, a bubbling ooze rim, drips and acid vapour; the die glows sickly green; a splash of bubbles
// and droplets on landing.
import type { RichPreset } from "../fx-sim";
import type { RichKindDef, TileDraw } from "./kind";
import { AURA_HEAD, AURA_SHAPE } from "./shaders";
import { soft } from "./tiles";

const ACID: RichPreset = {
  species: [
    {
      // Bubbles: swell in place, then pop (gone at the end of their life).
      tile: "acid-bubble",
      additive: false,
      life: [0.45, 0.9],
      size: [0.25, 1],
      speed: [0.1, 0.5],
      drag: 3,
      drift: [0, 0],
      spin: 0.6,
      from: [0.9, 1.45],
      lift: 1.05,
      ramp: [
        [0, 0.55, 1, 0.25, 0],
        [0.12, 0.55, 1, 0.25, 0.9],
        [0.85, 0.7, 1, 0.35, 0.95],
        [1, 0.85, 1, 0.5, 0],
      ],
      twinkle: 0,
    },
    {
      // Pops: a quick ring of spatter where a bubble burst.
      tile: "acid-pop",
      additive: true,
      life: [0.12, 0.22],
      size: [0.6, 1.2],
      speed: [0, 0.3],
      drag: 2,
      drift: [0, 0],
      spin: 1,
      from: [0.6, 1.4],
      lift: 1.1,
      ramp: [
        [0, 0.8, 1, 0.45, 1],
        [1, 0.35, 0.9, 0.1, 0],
      ],
      twinkle: 0,
    },
    {
      // Drips and spatter: green droplets flicked off, running down the screen.
      tile: "dot",
      additive: false,
      life: [0.5, 0.9],
      size: [0.2, 0.1],
      speed: [0.8, 2.4],
      drag: 2.6,
      drift: [0, 1.6],
      spin: 0,
      from: [0.6, 1],
      lift: 1.1,
      ramp: [
        [0, 0.6, 1, 0.2, 1],
        [0.6, 0.4, 0.85, 0.12, 0.9],
        [1, 0.3, 0.7, 0.1, 0],
      ],
      twinkle: 0,
    },
    {
      // Acid vapour on the floor, under the die.
      tile: "dot",
      additive: false,
      life: [0.8, 1.3],
      size: [1, 2.6],
      speed: [0.2, 0.5],
      drag: 1,
      drift: [0, -0.3],
      spin: 0,
      from: [0.3, 0.8],
      lift: null,
      ramp: [
        [0, 0.35, 0.7, 0.15, 0],
        [0.3, 0.35, 0.7, 0.15, 0.22],
        [1, 0.3, 0.6, 0.12, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 24, burst: 26, burstSpeed: 4.5 },
    { species: 1, rate: 16, burst: 10, burstSpeed: 4 },
    { species: 2, rate: 14, burst: 30, burstSpeed: 1.6 },
    { species: 3, rate: 9, burst: 8, burstSpeed: 2.5 },
  ],
  glow: {
    emissive: 0x4cff1a,
    range: [0.12, 0.32],
    hz: 3.5,
    tint: { color: 0xa8ff70, amount: 0.1 },
  },
};

/** A bubble: a thin bright skin over a faint fill, with a highlight. */
const bubble: TileDraw = (g, px) => {
  const h = px / 2;
  const r = h * 0.86;
  const fill = g.createRadialGradient(h, h, r * 0.2, h, h, r);
  fill.addColorStop(0, "rgba(255,255,255,0.18)");
  fill.addColorStop(0.75, "rgba(255,255,255,0.35)");
  fill.addColorStop(1, "rgba(255,255,255,0.9)");
  g.fillStyle = fill;
  g.beginPath();
  g.arc(h, h, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = h * 0.08;
  g.beginPath();
  g.arc(h, h, r - h * 0.04, 0, Math.PI * 2);
  g.stroke();
  // Highlight, top left.
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = h * 0.1;
  g.lineCap = "round";
  g.beginPath();
  g.arc(h, h, r * 0.62, Math.PI * 1.1, Math.PI * 1.45);
  g.stroke();
  soft(g, h - r * 0.38, h - r * 0.42, r * 0.16, 1);
};

/** A pop: a broken ring of spatter. */
const pop: TileDraw = (g, px) => {
  const h = px / 2;
  g.save();
  g.translate(h, h);
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineCap = "round";
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + (k % 2) * 0.2;
    const r0 = h * (0.45 + (k % 3) * 0.06);
    g.lineWidth = h * (k % 2 ? 0.07 : 0.1);
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a) * h * 0.72, Math.sin(a) * h * 0.72);
    g.stroke();
    soft(g, Math.cos(a) * h * 0.84, Math.sin(a) * h * 0.84, h * 0.11, 1);
  }
  g.restore();
};

/** A dripping ooze rim: lumpy green slime round the die, bubbles boiling in it, drips running down. */
const ACID_FRAG = /* glsl */ `
${AURA_HEAD}
// Bubbles in the ooze, each swelling and popping: the brightest skin near p.
float cells(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float best = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      float h = h3(vec3(i + g, uSeed));
      vec2 o = vec2(h3(vec3(i + g, 7.0 + uSeed)), h3(vec3(i + g, 13.0 + uSeed)));
      float life = fract(t * (0.6 + 0.8 * h) + h * 5.0);
      float r = 0.12 + 0.3 * life;
      float e = length(g + o * 0.8 + 0.1 - f);
      float skin = smoothstep(0.08, 0.0, abs(e - r)) * smoothstep(1.0, 0.85, life);
      best = max(best, skin);
    }
  }
  return best;
}
void main() {
  ${AURA_SHAPE}
  float n = fbm(vec3(dn * 2.0 + uSeed, uTime * 0.7));
  float edge = 1.05 + 0.4 * n;
  // Drips: narrow runs hanging down the screen from the lower rim, slowly lengthening.
  float col = q.x * 3.2 + uSeed;
  float ci = floor(col);
  float cf = fract(col) - 0.5;
  float hc = h3(vec3(ci, 3.0, uSeed));
  float len = (0.2 + 0.7 * hc) * (0.55 + 0.45 * fract(uTime * (0.25 + 0.3 * hc) + hc));
  float below = max(q.y - sqrt(max(edge * edge - q.x * q.x, 0.0)) + 0.15, 0.0);
  float w = 0.3 * (1.0 - smoothstep(0.0, len, below)) + 0.1;
  float under = step(0.35, hc) * step(0.0, q.y) * step(abs(q.x), edge * 0.8);
  float drip = under * smoothstep(w, w * 0.4, abs(cf))
    * (1.0 - smoothstep(len * 0.85, len + 0.05, below)) * step(0.001, below);
  float bead = under * smoothstep(0.13, 0.06, length(vec2(cf / 3.2, below - len)));
  // The ooze: a band from the die's edge out to its lumpy rim.
  float body = smoothstep(edge + 0.1, edge - 0.12, d) * smoothstep(0.75, 0.98, d);
  float rim = exp(-pow((d - edge + 0.05) / 0.13, 2.0));
  float boil = cells(q * 2.4, uTime) * body;
  float haze = exp(-max(d - edge, 0.0) * 2.0) * 0.2 * (0.6 + 0.4 * n);
  float slime = max(body, max(drip, bead));
  vec3 c = mix(vec3(0.1, 0.42, 0.02), vec3(0.6, 1.0, 0.22), clamp(rim * 0.5 + boil + bead * 0.6, 0.0, 1.0));
  float a = (slime * 0.42 + rim * 0.3 + boil * 0.7 + bead * 0.3 + haze) * uAmp;
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}`;

export const acid: RichKindDef = {
  preset: ACID,
  tiles: { "acid-bubble": bubble, "acid-pop": pop },
  aura: { frag: ACID_FRAG, size: 3 },
  whileRolling: true,
};
