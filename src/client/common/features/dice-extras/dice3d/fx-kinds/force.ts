// FR-DICEX-106: force dice (DM direction, 2026-11-06): transparent blue force fields popping
// outwards. A translucent hex-lattice shell hugs the die and pulses, field rings pop out of it in
// waves; glassy bubble shells and small hex plates break off; the die glows blue. Landing: the
// field pops, concentric shells and hex plates flung out.
import type { RichPreset } from "../fx-sim";
import type { RichKindDef, TileDraw } from "./kind";
import { AURA_HEAD, AURA_SHAPE } from "./shaders";

const BLUE: readonly [number, number, number] = [0.45, 0.68, 1];

const FORCE: RichPreset = {
  species: [
    {
      // Field bubbles: a glassy shell around the die, growing outward and popping.
      tile: "force-shell",
      additive: true,
      life: [0.45, 0.7],
      size: [2.3, 5.2],
      speed: [0, 0.15],
      drag: 2,
      drift: [0, 0],
      spin: 0.6,
      from: [0, 0.08],
      lift: 0.4,
      ramp: [
        [0, ...BLUE, 0],
        [0.12, 0.6, 0.8, 1, 0.75],
        [0.6, ...BLUE, 0.35],
        [1, 0.3, 0.5, 1, 0],
      ],
      twinkle: 0,
    },
    {
      // Hex plates: small pieces of the field breaking off.
      tile: "force-hex",
      additive: true,
      life: [0.4, 0.8],
      size: [0.4, 0.75],
      speed: [0.6, 1.6],
      drag: 1.6,
      drift: [0, 0],
      spin: 1.6,
      from: [1, 1.5],
      lift: 0.6,
      ramp: [
        [0, 0.8, 0.92, 1, 0],
        [0.15, 0.7, 0.86, 1, 0.9],
        [0.7, ...BLUE, 0.55],
        [1, 0.3, 0.5, 1, 0],
      ],
      twinkle: 0,
    },
    {
      // Glints on the field.
      tile: "star",
      additive: true,
      life: [0.3, 0.6],
      size: [0.35, 0.1],
      speed: [0.2, 0.8],
      drag: 2,
      drift: [0, 0],
      spin: 1,
      from: [1.1, 1.6],
      lift: 1.2,
      ramp: [
        [0, 0.9, 0.96, 1, 1],
        [1, ...BLUE, 0],
      ],
      twinkle: 9,
    },
    {
      // Landing: concentric shells popping out fast.
      tile: "force-shell",
      additive: true,
      life: [0.3, 0.6],
      size: [2.2, 8.5],
      speed: [0, 0],
      drag: 0,
      drift: [0, 0],
      spin: 0.4,
      from: [0, 0],
      lift: 0.4,
      ramp: [
        [0, 0.85, 0.94, 1, 1],
        [0.4, 0.55, 0.78, 1, 0.6],
        [1, 0.3, 0.5, 1, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 4, burst: 0, burstSpeed: 1 },
    { species: 1, rate: 24, burst: 26, burstSpeed: 3 },
    { species: 2, rate: 14, burst: 16, burstSpeed: 3 },
    { species: 3, rate: 0, burst: 3, burstSpeed: 1 },
  ],
  glow: {
    emissive: 0x3d7bff,
    range: [0.25, 0.5],
    hz: 3,
    tint: { color: 0xa8c4ff, amount: 0.22 },
  },
};

const hexPath = (g: CanvasRenderingContext2D, r: number) => {
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 6;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
};

/** A hex plate: a faint glassy fill with a bright, glowing edge. */
const forceHex: TileDraw = (g, px) => {
  const h = px / 2;
  g.save();
  g.translate(h, h);
  const r = h * 0.78;
  hexPath(g, r);
  const fill = g.createRadialGradient(0, 0, 0, 0, 0, r);
  fill.addColorStop(0, "rgba(255,255,255,0.12)");
  fill.addColorStop(1, "rgba(255,255,255,0.4)");
  g.fillStyle = fill;
  g.fill();
  g.shadowColor = "rgba(255,255,255,1)";
  g.shadowBlur = 14;
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 6;
  g.lineJoin = "round";
  hexPath(g, r);
  g.stroke();
  g.restore();
};

/** A force bubble: a thin bright rim with a fresnel-like fill, clear in the middle. */
const forceShell: TileDraw = (g, px) => {
  const h = px / 2;
  const r = h * 0.86;
  const fill = g.createRadialGradient(h, h, r * 0.45, h, h, r);
  fill.addColorStop(0, "rgba(255,255,255,0)");
  fill.addColorStop(0.75, "rgba(255,255,255,0.16)");
  fill.addColorStop(1, "rgba(255,255,255,0.45)");
  g.fillStyle = fill;
  g.beginPath();
  g.arc(h, h, r, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.shadowColor = "rgba(255,255,255,1)";
  g.shadowBlur = 10;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 3.5;
  g.beginPath();
  g.arc(h, h, r, 0, Math.PI * 2);
  g.stroke();
  g.restore();
};

/** A pulsing hex-lattice shell around the die, field rings popping out of it in waves. */
const FORCE_FRAG = /* glsl */ `
${AURA_HEAD}
float hexEdge(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 ag = abs(gv);
  float hd = max(dot(ag, normalize(r)), ag.x);
  return smoothstep(0.4, 0.49, hd);
}
void main() {
  ${AURA_SHAPE}
  float c = cos(uTime * 0.3 + uSeed);
  float s = sin(uTime * 0.3 + uSeed);
  float edge = hexEdge(mat2(c, -s, s, c) * q * 2.4);
  float pulse = 0.5 + 0.5 * sin(uTime * 6.0 + uSeed);
  float shellR = 1.2 + 0.08 * pulse;
  float rim = exp(-pow((d - shellR) / 0.11, 2.0));
  float fill = smoothstep(shellR + 0.05, shellR - 0.35, d) * smoothstep(0.8, 1.0, d);
  float rings = 0.0;
  for (int i = 0; i < 3; i++) {
    float ph = fract(uTime * 1.4 + float(i) / 3.0 + uSeed * 0.07);
    float r = shellR + ph * (uHalf - shellR - 0.25);
    float w = 0.08 + 0.22 * ph;
    float band = exp(-pow((d - r) / w, 2.0));
    rings += band * (1.0 - ph) * (1.0 - ph) * (0.3 + 0.9 * edge);
  }
  float alpha = (rim * (0.5 + 0.5 * edge) + fill * (0.12 + 0.45 * edge) + rings * 0.8) * uAmp;
  vec3 col = mix(vec3(0.18, 0.42, 1.0), vec3(0.78, 0.9, 1.0), clamp(rim * 0.7 + edge * 0.35, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

export const force: RichKindDef = {
  preset: FORCE,
  tiles: { "force-hex": forceHex, "force-shell": forceShell },
  aura: { frag: FORCE_FRAG, size: 3.4 },
  whileRolling: true,
};
