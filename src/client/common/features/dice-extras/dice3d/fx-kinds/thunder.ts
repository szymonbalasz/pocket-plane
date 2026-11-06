// FR-DICEX-106: thunder dice, the DM's direction (2026-11-06): an obvious rolling thundercloud. A
// dark cloud churns round and over each die (thinner over the die itself), lit from inside by
// flashes with little forks of lightning, cloud puffs rolling off it, faint rumble rings on the
// floor; the die darkens to storm grey. Landing: a thunderclap, a white flash, the cloud blown
// open and two shockwave rings racing across the floor with a ring of dust, gone well before LAND_S.
import { Group, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial } from "three";
import type { RichPreset } from "../fx-sim";
import type { RichExtra, RichKindDef, TileDraw } from "./kind";
import { bolts, jag, sliceRand } from "./lightning";
import { AURA_HEAD, AURA_SHAPE, AURA_VERT } from "./shaders";
import { soft } from "./tiles";

const THUNDER: RichPreset = {
  species: [
    {
      // Cloud puffs rolling off the cloud (and blown out by the clap).
      tile: "thunder-puff",
      additive: false,
      life: [0.5, 0.95],
      size: [1.3, 2.4],
      speed: [0.3, 0.9],
      drag: 1.4,
      drift: [0, 0],
      spin: 1.2,
      from: [0.9, 1.7],
      lift: 1.5,
      ramp: [
        [0, 0.2, 0.22, 0.28, 0],
        [0.25, 0.22, 0.24, 0.3, 0.55],
        [0.7, 0.28, 0.3, 0.36, 0.4],
        [1, 0.34, 0.36, 0.42, 0],
      ],
      twinkle: 0,
    },
    {
      // Dust kicked up by the clap, racing out along the floor.
      tile: "thunder-puff",
      additive: false,
      life: [0.35, 0.6],
      size: [0.7, 1.8],
      speed: [3.2, 5.8],
      drag: 3.6,
      drift: [0, 0],
      spin: 2,
      from: [0.6, 1],
      lift: null,
      ramp: [
        [0, 0.55, 0.52, 0.48, 0.5],
        [0.4, 0.5, 0.48, 0.45, 0.35],
        [1, 0.45, 0.44, 0.42, 0],
      ],
      twinkle: 0,
    },
    {
      // Glints of lightning inside the cloud.
      tile: "star",
      additive: true,
      life: [0.08, 0.2],
      size: [0.7, 0.3],
      speed: [0.1, 0.5],
      drag: 2,
      drift: [0, 0],
      spin: 2,
      from: [0.5, 1.8],
      lift: 1.7,
      ramp: [
        [0, 0.9, 0.95, 1, 1],
        [1, 0.5, 0.65, 1, 0],
      ],
      twinkle: 24,
    },
  ],
  emitters: [
    { species: 0, rate: 20, burst: 14, burstSpeed: 4.5 },
    { species: 1, rate: 0, burst: 34, burstSpeed: 1 },
    { species: 2, rate: 7, burst: 10, burstSpeed: 3 },
  ],
  glow: {
    emissive: 0x6f80c8,
    range: [0.05, 0.3],
    hz: 2.5,
    tint: { color: 0x4c5468, amount: 0.4 },
  },
};

/** A billowing cloud puff: lumps on a soft core. */
const puff: TileDraw = (g, px) => {
  const h = px / 2;
  const lumps = [
    [0, 0.05, 0.6, 0.85],
    [-0.3, -0.12, 0.42, 0.7],
    [0.3, -0.15, 0.44, 0.7],
    [0.02, -0.32, 0.4, 0.65],
    [-0.36, 0.22, 0.34, 0.55],
    [0.36, 0.24, 0.34, 0.55],
  ] as const;
  for (const [x, y, r, a] of lumps) soft(g, h + x * h, h + y * h, r * h, a);
};

/** The thundercloud: churning, rolling round the die, lit by flashes from inside. */
const CLOUD_FRAG = /* glsl */ `
${AURA_HEAD}
uniform float uFlash;
uniform vec2 uFlashAt;
uniform float uOpen;
void main() {
  ${AURA_SHAPE}
  // Blown open by the clap: the cloud swells outward and thins.
  vec2 c = q / (1.0 + uOpen * 1.6);
  float r = length(c);
  vec2 dir = c / max(r, 1e-3);
  // Rolling: the whole mass turns slowly while its billows churn.
  float ang = uTime * 0.6;
  float s = sin(ang);
  float k = cos(ang);
  mat2 turn = mat2(k, -s, s, k);
  vec2 p = turn * c;
  vec2 w = vec2(fbm(vec3(p * 0.7 + uSeed, uTime * 0.4)), fbm(vec3(p * 0.7 - uSeed + 5.2, uTime * 0.4)));
  float n = fbm(vec3(p * 0.95 + w * 0.9, uTime * 0.5 + uSeed));
  // Lit from the top left (fixed on screen): brighter where the billows rise toward the light.
  vec2 p2 = turn * (c + vec2(-0.3, -0.3));
  float n2 = fbm(vec3(p2 * 0.95 + w * 0.9, uTime * 0.5 + uSeed));
  // A lumpy cumulus outline round the die.
  float lump = fbm(vec3((turn * dir) * 1.7 + uSeed, uTime * 0.45));
  float edge = 2.1 + 1.4 * lump;
  float body = 1.0 - smoothstep(edge - 0.35 - 0.7 * n, edge, r);
  // Thinner over the die so it still shows through.
  float hole = mix(0.42, 1.0, smoothstep(0.5, 1.3, r));
  float dens = clamp(body * (0.62 + 0.5 * n) * hole, 0.0, 1.0);
  float lit = clamp((n - n2) * 3.2 + 0.45, 0.0, 1.0);
  float rim = smoothstep(edge - 1.0, edge - 0.15, r);
  vec3 col = mix(vec3(0.06, 0.07, 0.1), vec3(0.42, 0.45, 0.55), clamp(lit * 0.65 + rim * 0.3 + n * 0.15, 0.0, 1.0));
  vec2 f = c - uFlashAt;
  float fl = uFlash * exp(-dot(f, f) * 0.45);
  col += vec3(0.75, 0.84, 1.0) * fl * (0.45 + n);
  float a = dens * 0.92 * min(uAmp, 1.0) * (1.0 - uOpen);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

/** Two rings on the floor (radius, width, strength in die radii): rumble or the shockwave. */
const RING_FRAG = /* glsl */ `
${AURA_HEAD}
uniform vec3 uA;
uniform vec3 uB;
float band(float d, float n, vec3 R, out float inner) {
  float rr = R.x * (1.0 + 0.05 * (n - 0.5));
  float x = (d - rr) / R.y;
  // Behind the front, a faint haze toward the centre.
  inner = R.z * 0.28 * smoothstep(rr * 0.35, rr, d) * (1.0 - smoothstep(rr - 0.2 * R.y, rr, d));
  return R.z * exp(-x * x * (x > 0.0 ? 3.0 : 1.0));
}
void main() {
  ${AURA_SHAPE}
  float n = fbm(vec3(dn * 3.0 + uSeed, uTime * 2.0));
  float ia;
  float ib;
  float a = band(d, n, uA, ia);
  float b = band(d, n, uB, ib);
  float edge = max(a, b);
  float haze = max(ia, ib);
  vec3 col = mix(vec3(0.7, 0.78, 0.95), vec3(0.95, 0.97, 1.0), edge);
  gl_FragColor = vec4(col, clamp(edge * 0.95 + haze, 0.0, 1.0));
}`;

const CLOUD_SIZE = 4;
const RING_SIZE = 8;
/** In-cloud flashes: a new chance this often per second. */
const FLASH_HZ = 8;
const RUMBLE_S = 0.6;
const CLAP_S = 0.45;

interface CloudU {
  uTime: { value: number };
  uAmp: { value: number };
  uHalf: { value: number };
  uSeed: { value: number };
  uFlash: { value: number };
  uFlashAt: { value: { x: number; y: number } };
  uOpen: { value: number };
}

interface RingU {
  uTime: { value: number };
  uAmp: { value: number };
  uHalf: { value: number };
  uSeed: { value: number };
  uA: { value: { x: number; y: number; z: number } };
  uB: { value: { x: number; y: number; z: number } };
}

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);

/** A flash in die `k`'s cloud this slice: level over the slice (a double blink) and where. */
function flashOf(seed: number, k: number, slice: number, u: number) {
  const rand = sliceRand(seed, k, slice);
  if (rand() > 0.42) return null;
  const at = { x: (rand() * 2 - 1) * 1.4, y: (rand() * 2 - 1) * 1.4 };
  const level = u < 0.22 ? 1 : u < 0.38 ? 0.15 : u < 0.55 ? 0.65 : 0;
  return { at, level: level * (0.7 + rand() * 0.5), rand };
}

const thunderExtra: RichKindDef["extra"] = (dice, seed) => {
  const object = new Group();
  const geo = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const forks = bolts(dice.length * 2, dice.length);
  object.add(forks.mesh);
  const mats: ShaderMaterial[] = [];
  const parts = dice.map((d, k) => {
    const seedK = ((seed % 97) + k * 13.37) % 50;
    const cu: CloudU = {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uHalf: { value: CLOUD_SIZE },
      uSeed: { value: seedK },
      uFlash: { value: 0 },
      uFlashAt: { value: { x: 0, y: 0 } },
      uOpen: { value: 0 },
    };
    const cloudMat = new ShaderMaterial({
      uniforms: { ...cu },
      vertexShader: AURA_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    const cloud = new Mesh(geo, cloudMat);
    cloud.renderOrder = 0.5;
    cloud.frustumCulled = false;
    cloud.scale.set(d.radius * CLOUD_SIZE, 1, d.radius * CLOUD_SIZE);
    const ru: RingU = {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uHalf: { value: RING_SIZE },
      uSeed: { value: seedK },
      uA: { value: { x: 0, y: 1, z: 0 } },
      uB: { value: { x: 0, y: 1, z: 0 } },
    };
    const ringMat = new ShaderMaterial({
      uniforms: { ...ru },
      vertexShader: AURA_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    const ring = new Mesh(geo, ringMat);
    ring.renderOrder = 0.4;
    ring.frustumCulled = false;
    ring.scale.set(d.radius * RING_SIZE, 1, d.radius * RING_SIZE);
    object.add(ring, cloud);
    mats.push(cloudMat, ringMat);
    return { cloud, cu, ring, ru };
  });

  const setRing = (v: { x: number; y: number; z: number }, r: number, w: number, a: number) => {
    v.x = r;
    v.y = w;
    v.z = a;
  };

  const extra: RichExtra = {
    object,
    update(t, progress, _unit, sinceRest) {
      forks.begin();
      dice.forEach((d, k) => {
        const part = parts[k];
        if (!part) return;
        const { x, y, z } = d.mesh.position;
        const r = d.radius;
        const top = y + r * 1.6;
        part.cloud.position.set(x, y + r * 1.4, z);
        part.ring.position.set(x, 0.08, z);
        const { cu, ru } = part;
        cu.uTime.value = t;
        ru.uTime.value = t;
        if (sinceRest === null) {
          cu.uAmp.value = Math.min(1, progress / 0.06);
          cu.uOpen.value = 0;
          // Flashes inside the cloud, with little forks.
          const slice = Math.floor(t * FLASH_HZ);
          const f = flashOf(seed, k, slice + k * 5, t * FLASH_HZ - slice);
          cu.uFlash.value = f ? f.level : 0;
          if (f) {
            cu.uFlashAt.value = f.at;
            if (f.level > 0.3) {
              const fx = x + f.at.x * r;
              const fz = z + f.at.y * r;
              const a = f.rand() * Math.PI * 2;
              const len = r * (1 + f.rand() * 0.9);
              const pts = jag(
                [fx, fz, fx + Math.cos(a) * len, fz + Math.sin(a) * len],
                4,
                0.3,
                f.rand,
              );
              forks.ribbon(pts, top, r * 0.2, r * 0.06, f.level * 0.8);
            }
          }
          // Rumble: a faint ring rolling out under the cloud now and then.
          const ph = (t + k * 0.23) / RUMBLE_S;
          const u = ph - Math.floor(ph);
          setRing(ru.uA.value, 1.1 + 2.3 * easeOut(u), 0.14, 0.3 * (1 - u) * cu.uAmp.value);
          setRing(ru.uB.value, 0, 1, 0);
        } else {
          const s = sinceRest;
          // The clap: a white flash, the cloud blown open.
          cu.uAmp.value = 1;
          cu.uOpen.value = Math.min(1, s / 0.42);
          cu.uFlash.value = s < 0.1 ? 1.6 * (1 - s / 0.1) : 0;
          cu.uFlashAt.value = { x: 0, y: 0 };
          const flash = Math.max(0, 1 - s / 0.18);
          if (flash > 0) forks.disc(x, top, z, r * (3.5 + 2.5 * (1 - flash)), flash * 0.8);
          // Two shockwave rings racing out.
          const ua = Math.min(1, s / CLAP_S);
          setRing(
            ru.uA.value,
            0.9 + (RING_SIZE - 1.2) * easeOut(ua),
            0.2 + 0.3 * ua,
            ua < 1 ? (1 - ua) ** 1.3 : 0,
          );
          const ub = Math.max(0, Math.min(1, (s - 0.1) / (CLAP_S - 0.1)));
          setRing(
            ru.uB.value,
            0.9 + (RING_SIZE - 3) * easeOut(ub),
            0.16 + 0.2 * ub,
            s > 0.1 && ub < 1 ? 0.65 * (1 - ub) : 0,
          );
        }
      });
      forks.end();
    },
    land() {},
    dispose() {
      forks.dispose();
      geo.dispose();
      for (const m of mats) m.dispose();
    },
  };
  return extra;
};

export const thunder: RichKindDef = {
  preset: THUNDER,
  tiles: { "thunder-puff": puff },
  whileRolling: true,
  extra: thunderExtra,
};
