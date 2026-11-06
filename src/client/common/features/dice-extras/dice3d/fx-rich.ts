// FR-DICEX-106: fire and cold dice on the shared canvas, in the lazy chunk only. Per throw: one
// particle draw that adds light (flames, embers, glitter) and one that covers (smoke, mist,
// flakes), both from fx-sim.ts and moving with their die, plus one shader aura per die (fire:
// flame tongues all round it; cold: an icy rim with frost veins and mist). The die's own material glows (and
// frosts over). It runs in the throw's loop and, after rest, for the short landing only.
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  type Mesh,
  type MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Mesh as ThreeMesh,
} from "three";
import { pixelRatioOf } from "../arena";
import {
  LAND_S,
  landFade,
  landGlow,
  MAX_PARTICLES,
  type RichKind,
  type RichSim,
  richFlicker,
  richSim,
  type SimDie,
} from "./fx-sim";

export interface RichDie {
  mesh: Mesh;
  kind: RichKind;
  radius: number;
}

export interface RichLayer {
  object: Group;
  own: { dispose(): void }[];
  /** `t` seconds since the throw started, at `progress` (0–1), `unit` CSS px per world unit. */
  update(t: number, progress: number, unit: number): void;
  /** The dice rest: each bursts once; the landing runs until `active()` is false. */
  land(): void;
  active(): boolean;
  /** Nothing of it stays on the dice. */
  clear(): void;
}

const TILE_PX = 128;

/** The 2 × 2 sprite atlas: soft dot, ragged flame puff, snowflake, sparkle. */
function atlasCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE_PX * 2;
  c.height = TILE_PX * 2;
  const g = c.getContext("2d");
  if (!g) return c;
  const h = TILE_PX / 2;
  const soft = (x: number, y: number, r: number, a: number) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.4, `rgba(255,255,255,${a * 0.5})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  // 0: dot (top left).
  soft(h, h, h, 1);
  // 1: flame puff (top right): overlapping blobs, ragged edge.
  const blobs = [
    [0, 0, 0.62, 0.9],
    [0.22, -0.18, 0.4, 0.6],
    [-0.24, -0.1, 0.38, 0.55],
    [0.08, 0.26, 0.36, 0.5],
    [-0.15, 0.22, 0.3, 0.45],
    [0.28, 0.12, 0.28, 0.45],
  ] as const;
  for (const [x, y, r, a] of blobs) soft(TILE_PX + h + x * h, h + y * h, r * h, a);
  // 2: snowflake (bottom left): six branched arms with a soft glow.
  g.save();
  g.translate(h, TILE_PX + h);
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
  // 3: sparkle (bottom right): a four-point star on a soft core.
  const cx = TILE_PX + h;
  const cy = TILE_PX + h;
  soft(cx, cy, h * 0.45, 0.9);
  for (const [w, l] of [
    [0.09, 0.95],
    [0.05, 0.6],
  ] as const) {
    g.save();
    g.translate(cx, cy);
    if (l < 0.9) g.rotate(Math.PI / 4);
    for (const turn of [0, Math.PI / 2]) {
      g.save();
      g.rotate(turn);
      const grad = g.createLinearGradient(0, -h * l, 0, h * l);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.5, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(0, 0, h * w, h * l, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.restore();
  }
  return c;
}

const POINTS_VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
attribute float aRot;
attribute float aTile;
uniform float uScale;
varying vec4 vColor;
varying float vRot;
varying float vTile;
void main() {
  vColor = aColor;
  vRot = aRot;
  vTile = aTile;
  // The sprite is drawn at 1 / √2 of the point so it can turn without its corners clipping.
  gl_PointSize = aSize * uScale * 1.414;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const POINTS_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
varying float vRot;
varying float vTile;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vRot);
  float k = cos(vRot);
  c = mat2(k, -s, s, k) * c * 1.414 + 0.5;
  if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) discard;
  float col = mod(vTile, 2.0);
  float row = floor(vTile / 2.0);
  vec2 uv = vec2((c.x + col) * 0.5, 1.0 - (c.y + row) * 0.5);
  vec4 t = texture2D(uMap, uv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
}`;

const AURA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NOISE = /* glsl */ `
float h3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float n3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * n3(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s / 0.875;
}`;

/** Shared by both auras: q in die radii (screen x right, y down), d its distance from the die. */
const AURA_HEAD = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uHalf;
uniform float uSeed;
varying vec2 vUv;
${NOISE}
`;

const AURA_SHAPE = /* glsl */ `
  vec2 q = (vUv * 2.0 - 1.0) * uHalf;
  q.y = -q.y;
  float d = length(q);
  vec2 dn = q / max(length(q), 1e-3);
`;

const FIRE_FRAG = /* glsl */ `
${AURA_HEAD}
void main() {
  ${AURA_SHAPE}
  float n = fbm(vec3(dn * 2.4 + uSeed, d * 1.2 - uTime * 3.4));
  float m = fbm(vec3(q * 1.4 + uSeed * 3.0, uTime * 1.6));
  float reach = 0.25 + 1.7 * n * (0.6 + 0.8 * m);
  float heat = 1.0 - smoothstep(0.0, reach, d - 0.8);
  vec3 col = mix(vec3(0.6, 0.06, 0.0), vec3(1.0, 0.42, 0.04), smoothstep(0.05, 0.5, heat));
  col = mix(col, vec3(1.0, 0.86, 0.5), smoothstep(0.6, 0.98, heat));
  float a = smoothstep(0.0, 0.4, heat) * uAmp;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

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

function pointsOf(cap: number, map: CanvasTexture, additive: boolean) {
  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(new Float32Array(cap * 3), 3);
  const color = new Float32BufferAttribute(new Float32Array(cap * 4), 4);
  const size = new Float32BufferAttribute(new Float32Array(cap), 1);
  const rot = new Float32BufferAttribute(new Float32Array(cap), 1);
  const tile = new Float32BufferAttribute(new Float32Array(cap), 1);
  geometry.setAttribute("position", position);
  geometry.setAttribute("aColor", color);
  geometry.setAttribute("aSize", size);
  geometry.setAttribute("aRot", rot);
  geometry.setAttribute("aTile", tile);
  const scale = { value: 1 };
  const material = new ShaderMaterial({
    uniforms: { uMap: { value: map }, uScale: scale },
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = additive ? 3 : 1;
  return { points, geometry, material, scale, position, color, size, rot, tile };
}

interface AuraUniforms {
  uTime: { value: number };
  uAmp: { value: number };
  uHalf: { value: number };
  uSeed: { value: number };
}

interface Body {
  mesh: Mesh;
  kind: RichKind;
  radius: number;
  sim: RichSim;
  aura: ThreeMesh;
  u: AuraUniforms;
  /** The die's body colour before the frost (restored at clear). */
  base: Color | null;
}

/** The layer for these dice (each fire or cold), or null when there are none. */
export function richLayer(dice: readonly RichDie[], seed: number): RichLayer | null {
  if (dice.length === 0) return null;
  const map = new CanvasTexture(atlasCanvas());
  const kinds = [...new Set(dice.map((d) => d.kind))];
  // Each kind's simulation holds up to MAX_PARTICLES (a throw with fire and cold: both).
  const cap = MAX_PARTICLES * kinds.length;
  const add = pointsOf(cap, map, true);
  const cover = pointsOf(cap, map, false);
  const object = new Group();
  object.add(cover.points, add.points);
  const own: { dispose(): void }[] = [
    map,
    add.geometry,
    add.material,
    cover.geometry,
    cover.material,
  ];
  // One simulation per kind, sharing the throw's budget among its dice.
  const sims = new Map(
    kinds.map((k, j) => [
      k,
      richSim(k, dice.filter((d) => d.kind === k).length, seed * 31 + j * 7919 + 1),
    ]),
  );
  const plane = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  own.push(plane);
  const bodies: Body[] = dice.map((d, k) => {
    const sim = sims.get(d.kind) as RichSim;
    const u: AuraUniforms = {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uHalf: { value: sim.preset.aura },
      uSeed: { value: (k * 13.37) % 50 },
    };
    const auraMat = new ShaderMaterial({
      uniforms: { ...u },
      vertexShader: AURA_VERT,
      fragmentShader: d.kind === "fire" ? FIRE_FRAG : FROST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const aura = new ThreeMesh(plane, auraMat);
    aura.renderOrder = 2;
    aura.frustumCulled = false;
    object.add(aura);
    own.push(auraMat);
    // Materials are shared between dice of one look: each effect die gets its own.
    const m = d.mesh.material.clone() as MeshStandardMaterial;
    m.emissive.setHex(sim.preset.emissive);
    m.emissiveIntensity = 0;
    d.mesh.material = m;
    own.push(m);
    return {
      mesh: d.mesh,
      kind: d.kind,
      radius: d.radius,
      sim,
      aura,
      u,
      base: sim.preset.tint ? m.color.clone() : null,
    };
  });
  const tints = new Map(
    bodies.map((b) => [b, b.sim.preset.tint ? new Color(b.sim.preset.tint.color) : null]),
  );

  let last: number | null = null;
  let landedAt: number | null = null;
  let landPending = false;
  let now = 0;
  let done = false;

  const simDice = (kind: RichKind): SimDie[] =>
    bodies
      .filter((b) => b.kind === kind)
      .map((b) => ({
        x: b.mesh.position.x,
        y: b.mesh.position.y,
        z: b.mesh.position.z,
        r: b.radius,
      }));

  const write = (unit: number, fade: number) => {
    const scale = unit * pixelRatioOf(globalThis.devicePixelRatio);
    add.scale.value = scale;
    cover.scale.value = scale;
    let na = 0;
    let nc = 0;
    for (const sim of sims.values()) {
      for (let i = 0; i < sim.count; i++) {
        const p = sim.drawn(i, fade);
        const t = p.additive ? add : cover;
        const at = p.additive ? na++ : nc++;
        t.position.array.set([p.x, p.y, p.z], at * 3);
        t.color.array.set([p.r, p.g, p.b, p.a], at * 4);
        t.size.array[at] = p.size;
        t.rot.array[at] = p.rot;
        t.tile.array[at] = p.tile;
      }
    }
    add.geometry.setDrawRange(0, na);
    cover.geometry.setDrawRange(0, nc);
    for (const t of [add, cover]) {
      for (const a of [t.position, t.color, t.size, t.rot, t.tile]) a.needsUpdate = true;
    }
  };

  const clear = () => {
    done = true;
    object.visible = false;
    for (const s of sims.values()) s.clear();
    for (const b of bodies) {
      const m = b.mesh.material as MeshStandardMaterial;
      if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0;
      if (b.base && m.color) m.color.copy(b.base);
    }
  };

  return {
    object,
    own,
    update(t, progress, unit) {
      if (done) return;
      const dt = last === null ? 0 : Math.min(0.05, Math.max(0, t - last));
      last = t;
      now = t;
      if (landPending) {
        landPending = false;
        landedAt = t;
        for (const k of kinds) sims.get(k)?.burst(simDice(k));
      }
      const since = landedAt === null ? null : t - landedAt;
      if (since !== null && since >= LAND_S) {
        clear();
        return;
      }
      for (const k of kinds) sims.get(k)?.step(dt, simDice(k), landedAt === null);
      // In over the first moments of the throw; at full until the landing flares it out.
      const fadeIn = Math.min(1, progress / 0.06);
      const amp = since === null ? fadeIn : landGlow(since);
      bodies.forEach((b, k) => {
        const p = b.sim.preset;
        // The die may wear a new material by now (dropped dice dim at rest): drive its current one.
        const m = b.mesh.material as MeshStandardMaterial;
        const level = richFlicker(p, t, k);
        m.emissiveIntensity = (p.glow[0] + (p.glow[1] - p.glow[0]) * level) * Math.min(1, amp);
        const tint = tints.get(b);
        if (b.base && tint && p.tint) {
          m.color.copy(b.base).lerp(tint, p.tint.amount * Math.min(1, amp));
        }
        const { x, y, z } = b.mesh.position;
        b.aura.position.set(x, y, z);
        b.aura.scale.set(b.radius * p.aura, 1, b.radius * p.aura);
        const u = b.u;
        u.uTime.value = t;
        u.uAmp.value = amp;
      });
      write(unit, since === null ? 1 : landFade(since));
    },
    land() {
      if (done || landedAt !== null) return;
      landPending = true;
    },
    active() {
      if (done) return false;
      if (landPending) return true;
      return landedAt !== null && now - landedAt < LAND_S;
    },
    clear,
  };
}
