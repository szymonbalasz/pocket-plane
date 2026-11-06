// FR-DICEX-106: bludgeoning dice, a hammer (DM's direction, 2026-11-06). Nothing while rolling;
// at the landing a war hammer swings in and slams the die: a comic impact burst, a shockwave ring
// and cracks in the ground round the die, dust and rock chips flung out, the die squashed by the
// blow and springing back. The hammer is gone by 0.35 s, the rest within LAND_S.
import { Group } from "three";
import { prng, type RichPreset } from "../fx-sim";
import type { RichKindDef, TileDraw } from "./kind";
import { soft } from "./tiles";
import {
  clamp01,
  dirOf,
  FLOOR_Y,
  flatPlane,
  POP_HEAD,
  POP_SHAPE,
  type PopDie,
  popExtra,
  popMaterial,
  quad,
  smooth,
  spriteMaterial,
  spriteTexture,
} from "./weapon-kit";

/** The blow lands this long after rest (the swing before it). */
export const HAMMER_HIT_S = 0.075;
/** The hammer is gone by then. */
export const HAMMER_GONE_S = 0.36;

// Particles are born at rest but show from the blow: their ramps start invisible.
const BLUDGEONING: RichPreset = {
  species: [
    {
      // Dust: a ring of it rolling out along the floor.
      tile: "bludgeon-dust",
      additive: false,
      life: [0.55, 0.85],
      size: [1, 2.6],
      speed: [2.5, 4.5],
      drag: 4,
      drift: [0, 0],
      spin: 1.5,
      from: [0.85, 1.05],
      lift: null,
      ramp: [
        [0, 0.85, 0.77, 0.66, 0],
        [0.11, 0.85, 0.77, 0.66, 0],
        [0.18, 0.88, 0.8, 0.68, 0.8],
        [0.6, 0.75, 0.68, 0.58, 0.45],
        [1, 0.62, 0.56, 0.5, 0],
      ],
      twinkle: 0,
    },
    {
      // Rock chips flung out, tumbling.
      tile: "bludgeon-chip",
      additive: false,
      life: [0.4, 0.65],
      size: [0.42, 0.3],
      speed: [3, 6],
      drag: 3,
      drift: [0, 0],
      spin: 9,
      from: [0.8, 1],
      lift: 1.1,
      ramp: [
        [0, 0.72, 0.64, 0.55, 0],
        [0.14, 0.72, 0.64, 0.55, 0],
        [0.2, 0.75, 0.67, 0.58, 1],
        [0.75, 0.6, 0.53, 0.46, 0.9],
        [1, 0.5, 0.45, 0.4, 0],
      ],
      twinkle: 0,
    },
    {
      // Hot sparks off the strike.
      tile: "star",
      additive: true,
      life: [0.25, 0.42],
      size: [0.5, 0.12],
      speed: [3.5, 7],
      drag: 5,
      drift: [0, 0],
      spin: 3,
      from: [0.3, 0.7],
      lift: 1.8,
      ramp: [
        [0, 1, 0.9, 0.6, 0],
        [0.2, 1, 0.9, 0.6, 0],
        [0.26, 1, 0.95, 0.8, 1],
        [1, 1, 0.55, 0.15, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 0, burst: 40, burstSpeed: 1 },
    { species: 1, rate: 0, burst: 14, burstSpeed: 1 },
    { species: 2, rate: 0, burst: 12, burstSpeed: 1 },
  ],
};

/** A puff of dust: soft, lumpy. */
const dust: TileDraw = (g, px) => {
  const h = px / 2;
  for (const [x, y, r, a] of [
    [0, 0, 0.7, 0.7],
    [0.3, -0.2, 0.42, 0.5],
    [-0.28, 0.16, 0.45, 0.5],
    [0.12, 0.32, 0.36, 0.45],
  ] as const) {
    soft(g, h + x * h, h + y * h, r * h, a);
  }
};

/** A rock chip: an angular shard with a lit edge. */
const chip: TileDraw = (g, px) => {
  const h = px / 2;
  g.save();
  g.translate(h, h);
  g.beginPath();
  for (const [x, y] of [
    [-0.55, -0.2],
    [-0.1, -0.6],
    [0.5, -0.35],
    [0.6, 0.25],
    [0.05, 0.55],
    [-0.45, 0.35],
  ] as const) {
    g.lineTo(x * h, y * h);
  }
  g.closePath();
  g.fillStyle = "rgba(205,205,205,1)";
  g.fill();
  g.lineWidth = h * 0.1;
  g.strokeStyle = "rgba(255,255,255,1)";
  g.stroke();
  g.restore();
};

/** The comic impact burst: a spiky star round the die (under it), white-hot to orange. */
const BURST_FRAG = /* glsl */ `
${POP_HEAD}
void main() {
  ${POP_SHAPE}
  if (uT < 0.0) discard;
  float ang = atan(q.y, q.x) + uSeed;
  float n = 11.0;
  float cell = ang / 6.2831853 * n;
  float tri = abs(fract(cell) - 0.5) * 2.0;
  float len = 0.75 + 0.5 * h3(vec3(floor(cell), uSeed, 3.0));
  float grow = 1.0 - pow(1.0 - clamp(uT / 0.05, 0.0, 1.0), 2.0);
  float outer = mix(1.25, 1.25 + 1.6 * len, pow(1.0 - tri, 2.2)) * grow;
  float inside = smoothstep(outer, outer - 0.12, d);
  float life = 1.0 - smoothstep(0.05, 0.2, uT);
  float heat = clamp(1.0 - d / max(outer, 1e-3), 0.0, 1.0);
  vec3 col = mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.85, 0.4), smoothstep(0.1, 0.45, heat));
  col = mix(col, vec3(1.0, 1.0, 0.92), smoothstep(0.45, 0.8, heat));
  gl_FragColor = vec4(col, inside * life * 0.95);
}`;

/** Shockwave: a fast, bright ring and a slower second one, rolling out over the floor. */
const SHOCK_FRAG = /* glsl */ `
${POP_HEAD}
void main() {
  ${POP_SHAPE}
  if (uT < 0.0) discard;
  float ang = atan(q.y, q.x);
  float wob = 0.18 * (n3(vec3(cos(ang) * 3.0, sin(ang) * 3.0, uSeed)) - 0.5);
  float u = clamp(uT / 0.42, 0.0, 1.0);
  float r1 = 1.0 + 3.0 * (1.0 - pow(1.0 - u, 3.0));
  float w1 = mix(0.45, 0.07, u);
  float ring = exp(-pow((d - r1 + wob) / w1, 2.0)) * pow(1.0 - u, 1.3);
  float u2 = clamp((uT - 0.07) / 0.4, 0.0, 1.0);
  float r2 = 0.95 + 2.1 * (1.0 - pow(1.0 - u2, 3.0));
  float ring2 = exp(-pow((d - r2 - wob) / mix(0.3, 0.06, u2), 2.0)) * pow(1.0 - u2, 1.5);
  ring2 *= step(0.07, uT) * 0.6;
  float a = (ring + ring2) * uFade;
  vec3 col = mix(vec3(1.0, 0.78, 0.5), vec3(1.0, 0.97, 0.9), clamp(ring * 1.4 - 0.2, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

/** Cracks in the ground: jagged fissures racing out from under the die. */
const CRACK_FRAG = /* glsl */ `
${POP_HEAD}
// Piecewise-linear noise: straight segments between hashed knots (a zig-zag, not a squiggle).
float pl(float x, float s) {
  float i = floor(x);
  return mix(h3(vec3(i, s, 4.0)), h3(vec3(i + 1.0, s, 4.0)), fract(x));
}
void main() {
  ${POP_SHAPE}
  if (uT < 0.0) discard;
  float grow = 1.0 - pow(1.0 - clamp(uT / 0.07, 0.0, 1.0), 2.0);
  float ang = atan(q.y, q.x);
  float edge = 0.0;
  float core = 0.0;
  for (int k = 0; k < 7; k++) {
    float fk = float(k);
    float s = fk * 3.1 + uSeed;
    float a0 = (fk + 0.6 * h3(vec3(fk, uSeed, 1.0))) * 6.2831853 / 7.0;
    float len = (1.5 + 1.3 * h3(vec3(fk, uSeed, 2.0))) * grow;
    float da = mod(ang - a0 + 3.14159265, 6.2831853) - 3.14159265;
    float perp = da * d;
    float o = 0.6 * (pl(d * 1.9, s) - 0.5) * smoothstep(0.6, 1.3, d);
    float along = clamp(d / max(len, 1e-3), 0.0, 1.0);
    float on = step(d, len) * step(abs(da), 1.2) * smoothstep(0.7, 0.95, d);
    float w = mix(0.1, 0.018, along);
    float dist = abs(perp - o);
    // One branch forks off, part way out.
    float dB = len * (0.35 + 0.2 * h3(vec3(fk, uSeed, 6.0)));
    float side = h3(vec3(fk, uSeed, 7.0)) < 0.5 ? -1.0 : 1.0;
    float oB = o + side * (d - dB) * 0.6 + 0.25 * (pl(d * 2.3, s + 9.0) - 0.5) * (d - dB);
    float onB = on * step(dB, d) * step(d, dB + len * 0.4);
    float wB = w * 0.7;
    float distB = abs(perp - oB);
    edge = max(edge, on * smoothstep(w * 2.2, w, dist));
    edge = max(edge, onB * smoothstep(wB * 2.2, wB, distB));
    core = max(core, on * smoothstep(w, w * 0.35, dist));
    core = max(core, onB * smoothstep(wB, wB * 0.35, distB));
  }
  vec3 col = mix(vec3(0.9, 0.8, 0.64), vec3(0.06, 0.04, 0.02), core);
  float a = max(edge * 0.7, core) * uFade;
  gl_FragColor = vec4(col, a);
}`;

// The hammer sprite: a war hammer standing up, head at the top (canvas 220 × 400 px).
const HAMMER_PX: readonly [number, number] = [220, 400];
/** World size in die radii: width, height (the sprite's aspect). */
const HAMMER_W = 2.3;
const HAMMER_H = (HAMMER_W * HAMMER_PX[1]) / HAMMER_PX[0];
/** The head's centre, die radii up from the handle's end (the pivot). */
const HEAD_UP = HAMMER_H * (1 - 67 / HAMMER_PX[1]);

function drawHammer(g: CanvasRenderingContext2D, w: number, h: number) {
  const ink = "#140e09";
  // Handle: wood, with a leather grip and a steel pommel.
  const hx = w / 2 - 14;
  const wood = g.createLinearGradient(hx, 0, hx + 28, 0);
  wood.addColorStop(0, "#4a2c14");
  wood.addColorStop(0.45, "#a8743f");
  wood.addColorStop(1, "#4a2c14");
  g.fillStyle = wood;
  g.strokeStyle = ink;
  g.lineWidth = 5;
  g.beginPath();
  g.rect(hx, 116, 28, h - 132);
  g.fill();
  g.stroke();
  g.fillStyle = "#2c1a10";
  for (let y = 286; y < h - 22; y += 15) {
    g.beginPath();
    g.moveTo(hx, y);
    g.lineTo(hx + 28, y - 8);
    g.lineTo(hx + 28, y - 2);
    g.lineTo(hx, y + 6);
    g.fill();
  }
  g.fillStyle = "#8d969f";
  g.beginPath();
  g.roundRect(hx - 5, h - 24, 38, 20, 6);
  g.fill();
  g.stroke();
  // Head: a steel block, bevelled striking faces, a banded socket.
  const steel = g.createLinearGradient(0, 8, 0, 128);
  steel.addColorStop(0, "#f2f5f8");
  steel.addColorStop(0.35, "#b9c1ca");
  steel.addColorStop(0.75, "#6b7480");
  steel.addColorStop(1, "#444b55");
  g.fillStyle = steel;
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(8, 8, w - 16, 118, 16);
  g.fill();
  g.stroke();
  for (const x of [8, w - 40]) {
    const face = g.createLinearGradient(0, 8, 0, 126);
    face.addColorStop(0, "#ffffff");
    face.addColorStop(0.5, "#9aa4ae");
    face.addColorStop(1, "#3d434b");
    g.fillStyle = face;
    g.beginPath();
    g.roundRect(x, 4, 32, 126, 10);
    g.fill();
    g.stroke();
  }
  g.fillStyle = "#3a3f46";
  g.beginPath();
  g.rect(w / 2 - 22, 8, 44, 118);
  g.fill();
  g.stroke();
  g.fillStyle = "#d9dee3";
  for (const y of [30, 67, 104]) {
    g.beginPath();
    g.arc(w / 2, y, 6, 0, Math.PI * 2);
    g.fill();
  }
  // A glint along the top.
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 5;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(52, 22);
  g.lineTo(w / 2 - 32, 22);
  g.moveTo(w / 2 + 32, 22);
  g.lineTo(w - 52, 22);
  g.stroke();
}

/** The swing's angle offset from the blow's pose (radians, toward the raised side). */
function swingAt(since: number): number {
  if (since < HAMMER_HIT_S) {
    const u = since / HAMMER_HIT_S;
    return 1.75 * (1 - u * u);
  }
  // A recoil off the die, then it rests on it.
  const v = since - HAMMER_HIT_S;
  return 0.16 * Math.sin(Math.PI * clamp01(v / 0.13)) + 0.05 * smooth(0.06, 0.13, v);
}

const GHOSTS = [0.006, 0.012] as const;

export const bludgeoning: RichKindDef = {
  preset: BLUDGEONING,
  tiles: { "bludgeon-dust": dust, "bludgeon-chip": chip },
  whileRolling: false,
  extra: (dice, seed) =>
    popExtra(dice, (die, k, own) => {
      const rand = prng(seed * 977 + k * 131 + 7);
      const r = die.radius;
      const object = new Group();
      // Floor: cracks, then the shock rings, then the burst (all under the die).
      const crack = popMaterial(CRACK_FRAG, { half: 3.2, seed: rand() * 40 });
      const shock = popMaterial(SHOCK_FRAG, { half: 4.4, seed: rand() * 40, additive: true });
      const burst = popMaterial(BURST_FRAG, { half: 3, seed: rand() * 6.28, additive: true });
      const unit = flatPlane(2, 2);
      const floors = [
        { m: quad(unit, crack.material), half: 3.2, y: FLOOR_Y, order: 1 },
        { m: quad(unit, shock.material), half: 4.4, y: FLOOR_Y + 0.004, order: 2 },
        { m: quad(unit, burst.material), half: 3, y: FLOOR_Y + 0.008, order: 2 },
      ];
      for (const f of floors) {
        f.m.renderOrder = f.order;
        f.m.scale.set(r * f.half, 1, r * f.half);
        object.add(f.m);
      }
      // The hammer: turns about the handle's end; two fading ghosts smear the swing.
      const tex = spriteTexture(HAMMER_PX[0], HAMMER_PX[1], drawHammer);
      const sheet = flatPlane(HAMMER_W * r, HAMMER_H * r);
      const hammers = [0, ...GHOSTS].map((lag, i) => {
        const pivot = new Group();
        const material = spriteMaterial(tex);
        const m = quad(sheet, material);
        m.position.z = -(HAMMER_H * r) / 2;
        m.renderOrder = 6 - i;
        pivot.add(m);
        object.add(pivot);
        own.push(material);
        return { pivot, material, lag };
      });
      own.push(unit, sheet, tex, crack.material, shock.material, burst.material);
      // The blow's pose: the handle mostly below the die, swung in from either side.
      const hand = rand() < 0.5 ? 1 : -1;
      const pose = (rand() * 2 - 1) * 0.6;
      let rest: { x: number; y: number; z: number } | null = null;
      const squash = (s: number) => {
        const v = s - HAMMER_HIT_S;
        const a = v < 0 ? 0 : 0.13 * Math.exp(-v / 0.07) * Math.cos(v * 38);
        die.mesh.scale.set(1 + a, 1 - 1.5 * a, 1 + a);
      };
      const pop: PopDie = {
        object,
        place(d) {
          const p = d.mesh.position;
          rest = { x: p.x, y: p.y, z: p.z };
          for (const f of floors) f.m.position.set(p.x, f.y, p.z);
        },
        step(s) {
          if (!rest) return;
          const v = s - HAMMER_HIT_S;
          crack.u.uT.value = v;
          crack.u.uFade.value = 1 - smooth(0.45, 0.85, s);
          shock.u.uT.value = v;
          burst.u.uT.value = v;
          squash(s);
          // The pivot sits so that the head's striking face presses into the die at the blow.
          const up = Math.PI / 2 + pose;
          const u = dirOf(up);
          const left = dirOf(up + Math.PI / 2);
          const px = rest.x - u.x * HEAD_UP * r - hand * left.x * 1.6 * r;
          const pz = rest.z - u.z * HEAD_UP * r - hand * left.z * 1.6 * r;
          const show = smooth(0, 0.02, s) * (1 - smooth(0.2, HAMMER_GONE_S, s));
          for (const h of hammers) {
            const at = s - h.lag;
            // Closer to the camera while raised: bigger.
            const lift = 1 + 0.3 * clamp01(1 - at / HAMMER_HIT_S);
            h.pivot.position.set(px, rest.y + 2.5 * r, pz);
            h.pivot.rotation.y = pose - hand * swingAt(Math.max(0, at));
            h.pivot.scale.set(lift, 1, lift);
            const ghost = h.lag === 0 ? 1 : 0.4 - h.lag * 16;
            const swinging = h.lag === 0 ? 1 : 1 - smooth(HAMMER_HIT_S, HAMMER_HIT_S + 0.04, s);
            h.material.opacity = show * ghost * swinging;
          }
        },
        clear() {
          die.mesh.scale.set(1, 1, 1);
        },
      };
      return pop;
    }),
};
