// FR-DICEX-106: the full damage effects on the shared canvas, in the lazy chunk only, each kind as
// its fx-kinds/<kind>.ts defines it. Per throw: one sprite atlas (the kinds' tiles), one particle
// draw that adds light (flames, embers, glitter) and one that covers (smoke, mist, flakes), both
// from fx-sim.ts and moving with their die; per die a shader aura (fire: flame tongues all round
// it; cold: an icy rim with frost veins and mist) and its own material's glow (cold: frosting
// over); per kind an optional extra (custom three.js objects). It runs in the throw's loop and,
// after rest, for the landing only: LAND_S real seconds with everything in it (particles, the
// kinds' timelines, glow, auras) slowed to LAND_PACE, the landing clock (DM, 2026-11-06).
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
import type { RichKind } from "../die-fx";
import type { RichExtra, RichKindDef } from "./fx-kinds/kind";
import { AURA_VERT } from "./fx-kinds/shaders";
import { atlasCanvas, atlasLayout } from "./fx-kinds/tiles";
import {
  LAND_PACE,
  LAND_S,
  landClock,
  landFade,
  MAX_PARTICLES,
  type RichSim,
  richAmp,
  richFlicker,
  richSim,
  type SimDie,
} from "./fx-sim";

export interface RichDie {
  mesh: Mesh;
  kind: RichKind;
  def: RichKindDef;
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
uniform float uGrid;
varying vec4 vColor;
varying float vRot;
varying float vTile;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vRot);
  float k = cos(vRot);
  c = mat2(k, -s, s, k) * c * 1.414 + 0.5;
  if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) discard;
  float tile = floor(vTile + 0.5);
  float col = mod(tile, uGrid);
  float row = floor(tile / uGrid);
  vec2 uv = vec2((c.x + col) / uGrid, 1.0 - (c.y + row) / uGrid);
  vec4 t = texture2D(uMap, uv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
}`;

function pointsOf(cap: number, map: CanvasTexture, grid: number, additive: boolean) {
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
    uniforms: { uMap: { value: map }, uScale: scale, uGrid: { value: grid } },
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
  def: RichKindDef;
  radius: number;
  aura: { mesh: ThreeMesh; u: AuraUniforms; size: number } | null;
  /** The die wears its own clone of its material and glows (the kind has a glow). */
  glows: boolean;
  /** The die's body colour before the frost (restored at clear). */
  base: Color | null;
  tint: Color | null;
}

interface KindRun {
  kind: RichKind;
  def: RichKindDef;
  sim: RichSim;
  extra: RichExtra | null;
}

/** The layer for these dice (each of a built kind), or null when there are none. */
export function richLayer(dice: readonly RichDie[], seed: number): RichLayer | null {
  if (dice.length === 0) return null;
  const kinds = [...new Set(dice.map((d) => d.kind))];
  const defOf = new Map(dice.map((d) => [d.kind, d.def]));
  const layout = atlasLayout(kinds.map((k) => defOf.get(k)?.tiles ?? {}));
  const map = new CanvasTexture(atlasCanvas(layout));
  // Each kind's simulation holds up to MAX_PARTICLES (a throw with fire and cold: both).
  const cap = MAX_PARTICLES * kinds.length;
  const add = pointsOf(cap, map, layout.grid, true);
  const cover = pointsOf(cap, map, layout.grid, false);
  const object = new Group();
  object.add(cover.points, add.points);
  const own: { dispose(): void }[] = [
    map,
    add.geometry,
    add.material,
    cover.geometry,
    cover.material,
  ];
  const tileOf = (name: string) => layout.index.get(name) ?? 0;
  // Per kind: one simulation sharing the throw's budget among its dice, and its extra.
  const runs: KindRun[] = kinds.map((kind, j) => {
    const def = defOf.get(kind) as RichKindDef;
    const mine = dice.filter((d) => d.kind === kind);
    const s = seed * 31 + j * 7919;
    const extra =
      def.extra?.(
        mine.map((d) => ({ mesh: d.mesh, radius: d.radius })),
        s + 2,
      ) ?? null;
    if (extra) {
      if (!def.whileRolling) extra.object.visible = false;
      object.add(extra.object);
      own.push(extra);
    }
    return { kind, def, sim: richSim(def.preset, mine.length, s + 1, def.whileRolling), extra };
  });
  const plane = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  own.push(plane);
  const bodies: Body[] = dice.map((d, k) => {
    let aura: Body["aura"] = null;
    if (d.def.aura) {
      const u: AuraUniforms = {
        uTime: { value: 0 },
        uAmp: { value: 0 },
        uHalf: { value: d.def.aura.size },
        uSeed: { value: (k * 13.37) % 50 },
      };
      const auraMat = new ShaderMaterial({
        uniforms: { ...u },
        vertexShader: AURA_VERT,
        fragmentShader: d.def.aura.frag,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const mesh = new ThreeMesh(plane, auraMat);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      object.add(mesh);
      own.push(auraMat);
      aura = { mesh, u, size: d.def.aura.size };
    }
    const glow = d.def.preset.glow;
    let base: Color | null = null;
    if (glow) {
      // Materials are shared between dice of one look: each glowing die gets its own.
      const m = d.mesh.material.clone() as MeshStandardMaterial;
      m.emissive.setHex(glow.emissive);
      m.emissiveIntensity = 0;
      d.mesh.material = m;
      own.push(m);
      if (glow.tint) base = m.color.clone();
    }
    return {
      mesh: d.mesh,
      kind: d.kind,
      def: d.def,
      radius: d.radius,
      aura,
      glows: !!glow,
      base,
      tint: glow?.tint ? new Color(glow.tint.color) : null,
    };
  });

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
    for (const { sim } of runs) {
      for (let i = 0; i < sim.count; i++) {
        const p = sim.drawn(i, fade);
        const t = p.additive ? add : cover;
        const at = p.additive ? na++ : nc++;
        t.position.array.set([p.x, p.y, p.z], at * 3);
        t.color.array.set([p.r, p.g, p.b, p.a], at * 4);
        t.size.array[at] = p.size;
        t.rot.array[at] = p.rot;
        t.tile.array[at] = tileOf(p.tile);
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
    for (const r of runs) {
      r.sim.clear();
      r.extra?.clear?.();
    }
    for (const b of bodies) {
      if (!b.glows) continue;
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
        for (const r of runs) {
          r.sim.burst(simDice(r.kind));
          if (r.extra) {
            r.extra.object.visible = true;
            r.extra.land();
          }
        }
      }
      const real = landedAt === null ? null : t - landedAt;
      if (real !== null && real >= LAND_S) {
        clear();
        return;
      }
      // After rest it all runs on the landing clock: `since` and the effect's own time `ft`
      // (continuous at rest) at LAND_PACE, so each kind's timeline plays slower as a whole.
      const since = real === null ? null : landClock(real);
      const ft = landedAt === null || since === null ? t : landedAt + since;
      const fdt = since === null ? dt : dt * LAND_PACE;
      for (const r of runs) {
        r.sim.step(fdt, simDice(r.kind), landedAt === null);
        if (r.extra && (r.def.whileRolling || since !== null)) {
          r.extra.update(ft, progress, unit, since);
        }
      }
      bodies.forEach((b, k) => {
        const amp = richAmp(b.def.whileRolling, progress, since);
        const glow = b.def.preset.glow;
        if (glow && b.glows) {
          // The die may wear a new material by now (dropped dice dim at rest): drive its current one.
          const m = b.mesh.material as MeshStandardMaterial;
          const level = richFlicker(glow, ft, k);
          m.emissiveIntensity =
            (glow.range[0] + (glow.range[1] - glow.range[0]) * level) * Math.min(1, amp);
          if (b.base && b.tint && glow.tint) {
            m.color.copy(b.base).lerp(b.tint, glow.tint.amount * Math.min(1, amp));
          }
        }
        if (b.aura) {
          const { x, y, z } = b.mesh.position;
          b.aura.mesh.position.set(x, y, z);
          b.aura.mesh.scale.set(b.radius * b.aura.size, 1, b.radius * b.aura.size);
          b.aura.u.uTime.value = ft;
          b.aura.u.uAmp.value = amp;
        }
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
