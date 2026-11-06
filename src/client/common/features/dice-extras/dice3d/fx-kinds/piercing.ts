// FR-DICEX-106: piercing dice, an arrow (DM's direction, 2026-11-06). Nothing while rolling; at
// the landing an arrow streaks in with speed lines and drives into the die's side (the die hides
// its tip: it sits at the die's middle height), knocking the die back a touch and quivering; a
// sharp puncture star flashes where it went in and splinters and sparks fly. Over within LAND_S.
import { Group } from "three";
import { prng, type RichPreset } from "../fx-sim";
import type { RichKindDef, TileDraw } from "./kind";
import {
  clamp01,
  dirOf,
  easeOut,
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

/** The arrow strikes this long after rest. */
export const ARROW_HIT_S = 0.06;
/** The arrow is gone by then. */
export const ARROW_GONE_S = 0.72;

const PIERCING: RichPreset = {
  species: [
    {
      // Wood splinters, spinning away.
      tile: "pierce-splinter",
      additive: false,
      life: [0.4, 0.62],
      size: [0.7, 0.45],
      speed: [2.5, 5.5],
      drag: 4,
      drift: [0, 0],
      spin: 12,
      from: [0.7, 1],
      lift: 1.3,
      ramp: [
        [0, 0.95, 0.8, 0.55, 0],
        [0.12, 0.95, 0.8, 0.55, 0],
        [0.18, 0.98, 0.86, 0.62, 1],
        [0.7, 0.85, 0.68, 0.45, 0.85],
        [1, 0.7, 0.55, 0.35, 0],
      ],
      twinkle: 0,
    },
    {
      // Sparks off the steel head.
      tile: "star",
      additive: true,
      life: [0.22, 0.38],
      size: [0.45, 0.1],
      speed: [3.5, 7],
      drag: 5,
      drift: [0, 0],
      spin: 2,
      from: [0.6, 0.95],
      lift: 1.8,
      ramp: [
        [0, 1, 1, 0.9, 0],
        [0.18, 1, 1, 0.9, 0],
        [0.24, 1, 1, 0.95, 1],
        [1, 1, 0.75, 0.35, 0],
      ],
      twinkle: 0,
    },
  ],
  emitters: [
    { species: 0, rate: 0, burst: 16, burstSpeed: 1 },
    { species: 1, rate: 0, burst: 12, burstSpeed: 1 },
  ],
};

/** A splinter: a thin, pointed sliver of wood with a pale edge. */
const splinter: TileDraw = (g, px) => {
  const h = px / 2;
  g.save();
  g.translate(h, h);
  g.rotate(0.4);
  g.beginPath();
  g.moveTo(-h * 0.92, 0);
  g.lineTo(-h * 0.2, -h * 0.1);
  g.lineTo(h * 0.9, -h * 0.02);
  g.lineTo(h * 0.1, h * 0.12);
  g.closePath();
  g.fillStyle = "rgba(215,215,215,1)";
  g.fill();
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = h * 0.05;
  g.stroke();
  g.restore();
};

/** Speed lines behind the arrow: three thin streaks, brightest at the head. */
const STREAK_FRAG = /* glsl */ `
${POP_HEAD}
void main() {
  // u: 0 at the tail end, 1 at the arrow; v: -1..1 across.
  float u = vUv.x;
  float v = vUv.y * 2.0 - 1.0;
  float a = 0.0;
  a += exp(-pow(v / 0.1, 2.0)) * smoothstep(0.0, 1.0, u);
  a += 0.7 * exp(-pow((v - 0.55) / 0.07, 2.0)) * smoothstep(0.35, 1.0, u);
  a += 0.7 * exp(-pow((v + 0.5) / 0.07, 2.0)) * smoothstep(0.25, 1.0, u);
  vec3 col = mix(vec3(0.75, 0.88, 1.0), vec3(1.0), u);
  gl_FragColor = vec4(col, clamp(a * uFade, 0.0, 1.0));
}`;

/** The puncture: a sharp, uneven star of thin rays round a white-hot point, and a quick ring. */
const STAR_FRAG = /* glsl */ `
${POP_HEAD}
void main() {
  ${POP_SHAPE}
  if (uT < 0.0) discard;
  float grow = 1.0 - pow(1.0 - clamp(uT / 0.035, 0.0, 1.0), 2.0);
  float life = 1.0 - smoothstep(0.03, 0.26, uT);
  float ang = atan(q.y, q.x) + uSeed;
  float n = 9.0;
  float cell = ang / 6.2831853 * n;
  float tri = abs(fract(cell) - 0.5) * 2.0;
  float len = (0.55 + 0.45 * h3(vec3(floor(cell), uSeed, 5.0))) * uHalf * grow;
  float ray = pow(1.0 - tri, 14.0) * smoothstep(len, len * 0.3, d);
  float core = exp(-d * d / 0.08) * 1.4;
  float u = clamp(uT / 0.2, 0.0, 1.0);
  float ringR = 0.2 + 1.3 * (1.0 - pow(1.0 - u, 2.0));
  float ring = exp(-pow((d - ringR) / 0.06, 2.0)) * (1.0 - u) * 0.8;
  float a = (ray + core + ring) * life;
  vec3 col = mix(vec3(1.0, 0.86, 0.55), vec3(1.0, 1.0, 0.96), clamp(core + ray * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

// The arrow sprite, pointing right (canvas 512 × 120 px), the tip at x 508.
const ARROW_PX: readonly [number, number] = [512, 120];
/** World length in die radii, and height (the sprite's aspect). */
const ARROW_L = 4.6;
const ARROW_T = (ARROW_L * ARROW_PX[1]) / ARROW_PX[0];
const TIP = ARROW_L * (508 / ARROW_PX[0] - 0.5);

function drawArrow(g: CanvasRenderingContext2D, _w: number, h: number) {
  const ink = "#120c08";
  const mid = h / 2;
  g.lineJoin = "round";
  g.strokeStyle = ink;
  // Fletching: red and white feathers, top and bottom.
  for (const side of [-1, 1]) {
    g.fillStyle = side < 0 ? "#e0402c" : "#f1ebdf";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(22, mid + side * 8);
    g.lineTo(52, mid + side * 54);
    g.lineTo(168, mid + side * 34);
    g.lineTo(172, mid + side * 8);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = side < 0 ? "rgba(255,235,225,0.85)" : "rgba(190,45,30,0.95)";
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(84, mid + side * 12);
    g.lineTo(104, mid + side * 40);
    g.stroke();
    g.strokeStyle = ink;
  }
  // Shaft: light wood.
  const wood = g.createLinearGradient(0, mid - 10, 0, mid + 10);
  wood.addColorStop(0, "#f0cb8e");
  wood.addColorStop(0.5, "#c08f52");
  wood.addColorStop(1, "#7a5228");
  g.fillStyle = wood;
  g.lineWidth = 5;
  g.beginPath();
  g.rect(14, mid - 10, 400, 20);
  g.fill();
  g.stroke();
  // Nock.
  g.fillStyle = "#2a1c12";
  g.beginPath();
  g.rect(6, mid - 13, 16, 26);
  g.fill();
  // Ferrule and the steel broadhead.
  g.fillStyle = "#3b4048";
  g.beginPath();
  g.rect(398, mid - 14, 30, 28);
  g.fill();
  g.stroke();
  const steel = g.createLinearGradient(0, mid - 44, 0, mid + 44);
  steel.addColorStop(0, "#ffffff");
  steel.addColorStop(0.45, "#c9d1da");
  steel.addColorStop(1, "#56606b");
  g.fillStyle = steel;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(508, mid);
  g.lineTo(412, mid - 44);
  g.lineTo(436, mid);
  g.lineTo(412, mid + 44);
  g.closePath();
  g.fill();
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(498, mid - 2);
  g.lineTo(436, mid - 2);
  g.stroke();
}

/** How far the tip has come (die radii from where it stops; 0 = in) `since` seconds after rest. */
function flightAt(since: number): number {
  if (since >= ARROW_HIT_S) return 0;
  return 8 * (1 - since / ARROW_HIT_S);
}

export const piercing: RichKindDef = {
  preset: PIERCING,
  tiles: { "pierce-splinter": splinter },
  whileRolling: false,
  extra: (dice, seed) =>
    popExtra(dice, (die, k, own) => {
      const rand = prng(seed * 613 + k * 173 + 3);
      const r = die.radius;
      const object = new Group();
      // Mostly from above and the sides (screen angle of flight, counter-clockwise from right).
      const heading = -Math.PI / 2 + (rand() * 2 - 1) * 1.25;
      const tex = spriteTexture(ARROW_PX[0], ARROW_PX[1], drawArrow);
      const material = spriteMaterial(tex);
      const sheet = flatPlane(ARROW_L * r, ARROW_T * r);
      const arrow = quad(sheet, material);
      arrow.position.x = -TIP * r;
      arrow.renderOrder = 4;
      // Turns about its tip: the quiver.
      const pivot = new Group();
      pivot.add(arrow);
      const streak = popMaterial(STREAK_FRAG, { additive: true });
      const streakSheet = flatPlane(6.5 * r, 1.1 * r);
      const lines = quad(streakSheet, streak.material);
      lines.position.x = -(TIP + 3) * r;
      lines.renderOrder = 3;
      pivot.add(lines);
      const star = popMaterial(STAR_FRAG, { half: 2.8, seed: rand() * 6.28, additive: true });
      const unit = flatPlane(2, 2);
      const puncture = quad(unit, star.material);
      puncture.renderOrder = 7;
      puncture.scale.set(2.8 * r, 1, 2.8 * r);
      object.add(pivot, puncture);
      own.push(tex, material, sheet, streakSheet, streak.material, unit, star.material);
      const dir = dirOf(heading);
      let rest: { x: number; y: number; z: number } | null = null;
      const pop: PopDie = {
        object,
        place(d) {
          const p = d.mesh.position;
          rest = { x: p.x, y: p.y, z: p.z };
          // At the die's middle height: the die covers the buried tip (and keeps its value clear).
          pivot.position.set(p.x + dir.x * 0.1 * r, p.y * 0.8, p.z + dir.z * 0.1 * r);
          // The puncture where it went in: the die's edge toward the shooter, over the die.
          puncture.position.set(p.x - dir.x * 0.8 * r, p.y + 2.2 * r, p.z - dir.z * 0.8 * r);
        },
        step(s) {
          const v = s - ARROW_HIT_S;
          const back = flightAt(s);
          // Through the tip's pivot: slide back along the flight while it flies.
          arrow.position.x = -(TIP + back) * r;
          lines.position.x = -(TIP + back + 3.2) * r;
          const quiver = v < 0 ? 0 : 0.1 * Math.exp(-v / 0.16) * Math.sin(v * 70);
          pivot.rotation.y = heading + quiver;
          material.opacity = smooth(0, 0.012, s) * (1 - smooth(0.48, ARROW_GONE_S, s));
          streak.u.uFade.value = clamp01(1 - (v < 0 ? 0 : easeOut(v / 0.1))) * smooth(0, 0.015, s);
          star.u.uT.value = v;
          // The blow knocks the die back a little along the flight, and it settles.
          if (rest) {
            const knock = v < 0 ? 0 : 0.16 * (1 - Math.exp(-v / 0.012)) * Math.exp(-v / 0.09);
            die.mesh.position.set(rest.x + dir.x * knock * r, rest.y, rest.z + dir.z * knock * r);
          }
        },
        clear() {
          if (rest) die.mesh.position.set(rest.x, rest.y, rest.z);
        },
      };
      return pop;
    }),
};
