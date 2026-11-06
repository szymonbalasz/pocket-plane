// FR-DICEX-106: slashing dice, a fruit-ninja style slash (DM's direction, 2026-11-06). Nothing
// while rolling; at the landing a bright blade swipe cuts across the die: a curved streak, white
// at its core with an ice-blue edge, its head racing across and its tail chasing it out; the die
// flashes, a sharp gleam flares on the cut and sparks fly. Over well within LAND_S.
import { Group } from "three";
import { prng, type RichPreset } from "../fx-sim";
import type { RichKindDef } from "./kind";
import {
  dirOf,
  flatPlane,
  POP_HEAD,
  POP_SHAPE,
  type PopDie,
  popExtra,
  popMaterial,
  quad,
} from "./weapon-kit";

/** The swipe's head is across the die by then; the streak is gone by SLASH_GONE_S. */
export const SLASH_CUT_S = 0.1;
export const SLASH_GONE_S = 0.3;

const SLASHING: RichPreset = {
  species: [
    {
      // Sparks off the blade.
      tile: "star",
      additive: true,
      life: [0.25, 0.45],
      size: [0.5, 0.1],
      speed: [3, 6.5],
      drag: 5,
      drift: [0, 0],
      spin: 3,
      from: [0.2, 0.7],
      lift: 1.8,
      ramp: [
        [0, 1, 1, 1, 0],
        [0.12, 1, 1, 1, 0],
        [0.18, 1, 1, 0.95, 1],
        [0.6, 0.75, 0.9, 1, 0.8],
        [1, 0.45, 0.7, 1, 0],
      ],
      twinkle: 9,
    },
    {
      // Fine glitter left hanging on the cut.
      tile: "dot",
      additive: true,
      life: [0.3, 0.55],
      size: [0.2, 0.06],
      speed: [0.6, 2],
      drag: 3,
      drift: [0, 0],
      spin: 0,
      from: [0, 0.9],
      lift: 1.8,
      ramp: [
        [0, 1, 1, 1, 0],
        [0.15, 1, 1, 1, 0],
        [0.22, 0.85, 0.95, 1, 1],
        [1, 0.5, 0.75, 1, 0],
      ],
      twinkle: 14,
    },
  ],
  emitters: [
    { species: 0, rate: 0, burst: 18, burstSpeed: 1 },
    { species: 1, rate: 0, burst: 14, burstSpeed: 1 },
  ],
  // The die flashes white as it is cut (the landing's flare: gone by 0.4 s).
  glow: { emissive: 0xffffff, range: [0.14, 0.18], hz: 0 },
};

// The swipe's quad: SWIPE_L × SWIPE_W die radii, along its own +x.
const SWIPE_L = 6.4;
const SWIPE_W = 2.4;

/**
 * The swipe: x along the cut (-1..1), y across. A crescent bowed to one side; its head races
 * across (uT 0 → SLASH_CUT_S), the tail follows and the band thins out.
 */
const SWIPE_FRAG = /* glsl */ `
${POP_HEAD}
void main() {
  if (uT < 0.0) discard;
  float x = vUv.x * 2.0 - 1.0;
  float y = vUv.y * 2.0 - 1.0;
  float yy = y + 0.36 * (1.0 - x * x) - 0.18;
  float head = -1.05 + 2.1 * (1.0 - pow(1.0 - clamp(uT / ${SLASH_CUT_S}, 0.0, 1.0), 3.0));
  float tu = clamp((uT - 0.03) / 0.24, 0.0, 1.0);
  float tail = -1.05 + 2.1 * tu * tu;
  if (x > head || x < tail) discard;
  float k = (x - tail) / max(head - tail, 1e-3);
  // Thick behind the blade's point, thinning to the tail; pointed at both ends.
  float prof = pow(k, 0.55) * pow(1.0 - k, 0.18) * 1.25;
  float w = 0.3 * prof * (1.0 - smoothstep(0.1, ${SLASH_GONE_S}, uT));
  float ay = abs(yy);
  float core = smoothstep(w * 0.55, w * 0.2, ay);
  float edge = smoothstep(w * 1.1, w * 0.5, ay);
  float glow = exp(-pow(ay / (w * 1.9 + 0.004), 2.0)) * 0.55;
  vec3 col = mix(vec3(0.35, 0.75, 1.0), vec3(0.8, 0.94, 1.0), edge);
  col = mix(col, vec3(1.0), core);
  float a = max(max(core, edge * 0.9), glow) * (0.65 + 0.35 * k);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

/** The gleam: a sharp four-point glint with a soft core, turning a little, flaring and gone. */
const GLEAM_FRAG = /* glsl */ `
${POP_HEAD}
void main() {
  ${POP_SHAPE}
  if (uT < 0.0) discard;
  float u = clamp(uT / 0.26, 0.0, 1.0);
  float s = sin(3.14159265 * pow(u, 0.6));
  float t = uSeed + uT * 1.6;
  vec2 p = mat2(cos(t), -sin(t), sin(t), cos(t)) * q;
  float len = uHalf * s;
  float rays = exp(-abs(p.y) / (0.035 * len + 1e-3)) * smoothstep(len, 0.0, abs(p.x));
  rays += exp(-abs(p.x) / (0.035 * len + 1e-3)) * smoothstep(len, 0.0, abs(p.y));
  vec2 r45 = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p;
  float l2 = len * 0.45;
  rays += 0.6 * exp(-abs(r45.y) / (0.03 * l2 + 1e-3)) * smoothstep(l2, 0.0, abs(r45.x));
  rays += 0.6 * exp(-abs(r45.x) / (0.03 * l2 + 1e-3)) * smoothstep(l2, 0.0, abs(r45.y));
  float core = exp(-d * d / (0.06 * s + 1e-3)) * s;
  float a = (rays + core) * s;
  vec3 col = mix(vec3(0.7, 0.9, 1.0), vec3(1.0), clamp(core + rays * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

export const slashing: RichKindDef = {
  preset: SLASHING,
  whileRolling: false,
  extra: (dice, seed) =>
    popExtra(dice, (die, k, own) => {
      const rand = prng(seed * 389 + k * 211 + 5);
      const r = die.radius;
      const object = new Group();
      // A diagonal cut, either way, either direction (screen angle of the swipe).
      const diag = (rand() < 0.5 ? 1 : -1) * (0.45 + rand() * 0.5);
      const angle = diag + (rand() < 0.5 ? 0 : Math.PI);
      const swipe = popMaterial(SWIPE_FRAG);
      const sheet = flatPlane(SWIPE_L * r, SWIPE_W * r);
      const blade = quad(sheet, swipe.material);
      blade.rotation.y = angle;
      blade.renderOrder = 5;
      const gleam = popMaterial(GLEAM_FRAG, { half: 2.2, seed: rand() * 6.28, additive: true });
      const unit = flatPlane(2, 2);
      const glint = quad(unit, gleam.material);
      glint.scale.set(2.2 * r, 1, 2.2 * r);
      glint.renderOrder = 6;
      object.add(blade, glint);
      own.push(sheet, swipe.material, unit, gleam.material);
      // The glint sits on the cut, a little past the die's middle (where the blade bows).
      const across = dirOf(angle + Math.PI / 2);
      const pop: PopDie = {
        object,
        place(d) {
          const p = d.mesh.position;
          blade.position.set(p.x, p.y + 2 * r, p.z);
          glint.position.set(p.x + across.x * 0.1 * r, p.y + 2.4 * r, p.z + across.z * 0.1 * r);
        },
        step(s) {
          swipe.u.uT.value = s;
          gleam.u.uT.value = s - 0.04;
        },
      };
      return pop;
    }),
};
