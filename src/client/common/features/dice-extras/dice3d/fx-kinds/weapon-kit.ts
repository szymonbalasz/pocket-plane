// FR-DICEX-106: what the physical kinds' landing pops share (bludgeoning, piercing, slashing; used
// by those three only). The camera looks straight down (screen x = world x, screen down = world
// z), so a pop is a few flat quads per die: shader quads (rings, cracks, streaks, glints) and
// canvas-drawn sprites (a hammer, an arrow), timed from the landing (`since` seconds after rest).
import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  type Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
} from "three";
import type { ExtraDie, RichExtra } from "./kind";
import { AURA_VERT, NOISE } from "./shaders";

/** On the floor: under the dice (and the floor particles at 0.06). */
export const FLOOR_Y = 0.035;

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** 0 → 1 between `a` and `b`, smooth. */
export const smooth = (a: number, b: number, x: number): number => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
export const easeOut = (u: number): number => 1 - (1 - clamp01(u)) ** 3;

/** Screen direction (angle counter-clockwise from screen right) as world x, z. */
export const dirOf = (a: number): { x: number; z: number } => ({ x: Math.cos(a), z: -Math.sin(a) });

/** A `w` × `h` quad facing the camera: its width along screen x, its height along screen up. */
export const flatPlane = (w: number, h: number): PlaneGeometry =>
  new PlaneGeometry(w, h).rotateX(-Math.PI / 2);

/**
 * The fragment head for a pop's shader quad: uniforms uT (seconds since the hit; < 0 before it),
 * uFade (0–1), uHalf (half size, die radii), uSeed; `q` from POP_SHAPE as in AURA_SHAPE.
 */
export const POP_HEAD = /* glsl */ `
uniform float uT;
uniform float uFade;
uniform float uHalf;
uniform float uSeed;
varying vec2 vUv;
${NOISE}
`;

export const POP_SHAPE = /* glsl */ `
  vec2 q = (vUv * 2.0 - 1.0) * uHalf;
  q.y = -q.y;
  float d = length(q);
`;

export interface PopUniforms {
  uT: { value: number };
  uFade: { value: number };
  uHalf: { value: number };
  uSeed: { value: number };
}

/** A shader material for a pop quad (POP_HEAD uniforms). */
export function popMaterial(
  frag: string,
  o: { half?: number; seed?: number; additive?: boolean } = {},
): { material: ShaderMaterial; u: PopUniforms } {
  const u: PopUniforms = {
    uT: { value: -1 },
    uFade: { value: 1 },
    uHalf: { value: o.half ?? 1 },
    uSeed: { value: o.seed ?? 0 },
  };
  const material = new ShaderMaterial({
    uniforms: { ...u },
    vertexShader: AURA_VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: o.additive ? AdditiveBlending : NormalBlending,
  });
  return { material, u };
}

/** A canvas sprite (sRGB); blank where there is no 2D context (bun test). */
export function spriteTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g, w, h);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** A sprite's material: covers what is under it, faded by `opacity`. */
export const spriteMaterial = (map: Texture): MeshBasicMaterial =>
  new MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 0 });

/** A quad mesh that is never culled (it moves with its die). */
export function quad(geometry: PlaneGeometry, material: MeshBasicMaterial | ShaderMaterial): Mesh {
  const m = new Mesh(geometry, material);
  m.frustumCulled = false;
  return m;
}

/** One die's part of a pop: placed once at the landing, then stepped. */
export interface PopDie {
  object: Object3D;
  /** The landing starts: read the die's resting place. */
  place(die: ExtraDie): void;
  step(since: number): void;
  /** Put back anything changed on the die. */
  clear?(): void;
}

/**
 * A kind's extra from one `PopDie` per die (k = its index). `own` collects what to dispose; the
 * pop runs from the landing only (`whileRolling` false), driven by seconds since rest.
 */
export function popExtra(
  dice: readonly ExtraDie[],
  make: (die: ExtraDie, k: number, own: { dispose(): void }[]) => PopDie,
): RichExtra {
  const own: { dispose(): void }[] = [];
  const object = new Group();
  const parts = dice.map((d, k) => {
    const p = make(d, k, own);
    object.add(p.object);
    return { p, d };
  });
  let placed = false;
  return {
    object,
    update(_t, _progress, _unit, since) {
      if (since === null) return;
      if (!placed) {
        placed = true;
        for (const { p, d } of parts) p.place(d);
      }
      for (const { p } of parts) p.step(since);
    },
    land() {
      placed = false;
    },
    clear() {
      for (const { p } of parts) p.clear?.();
    },
    dispose() {
      for (const o of own) o.dispose();
    },
  };
}
