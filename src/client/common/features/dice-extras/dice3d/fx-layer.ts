// FR-DICEX-106: a throw's damage effects on the shared canvas, in the lazy chunk only: each die's
// own glow (a clone of its material), a soft halo under it and a few motes around it, as one Points
// draw each for the whole throw. Built only when a die has an effect; no extra frames (it runs in
// the throw's loop) and gone at rest, so the stills and hand-off copies stay clean. Fire and cold
// dice get the full effect instead (fx-rich.ts), which ends in a short landing burst after rest.
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  type Mesh,
  type MeshStandardMaterial,
  Points,
  PointsMaterial,
  SRGBColorSpace,
} from "three";
import { type DieFx, fxEnvelope, fxGlow, fxMote } from "../die-fx";
import { richLayer } from "./fx-rich";

const MOTES = 6;
/** The halo's height: above the shadow floor, below any die. */
const HALO_Y = 0.05;
const HALO_ALPHA = 0.32;
/** Sizes in die radii (a point's size is in px: scaled by the arena's px per world unit). */
const HALO_SIZE = 3.4;
const MOTE_SIZE = 0.34;

export interface FxDie {
  mesh: Mesh;
  fx: DieFx;
  /** The die's radius (world units). */
  radius: number;
}

export interface FxLayer {
  object: Group;
  own: { dispose(): void }[];
  /** `t` seconds in, at `progress` (0–1) of the throw, `unit` px per world unit. */
  update(t: number, progress: number, unit: number): void;
  /** At rest: the landing (fire and cold burst once), while `active()`; the rest is gone. */
  land(): void;
  /** Still landing: the throw's loop keeps drawing. */
  active(): boolean;
  /** Nothing of it stays on the dice (a still or hand-off copy, release). */
  clear(): void;
}

const dotCanvas = (): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return c;
};

function pointsOf(n: number, map: CanvasTexture) {
  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(new Float32Array(n * 3), 3);
  // RGBA: each point its own colour and fade.
  const color = new Float32BufferAttribute(new Float32Array(n * 4), 4);
  geometry.setAttribute("position", position);
  geometry.setAttribute("color", color);
  const material = new PointsMaterial({
    map,
    size: 1,
    sizeAttenuation: false,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return { points, geometry, material, position, color };
}

/** The layer for these dice, or null when none has an effect. */
export function fxLayer(dice: readonly FxDie[], seed = 0): FxLayer | null {
  const rich = richLayer(
    dice.flatMap(({ mesh, fx, radius }) => (fx.rich ? [{ mesh, kind: fx.rich, radius }] : [])),
    seed,
  );
  const plain = plainLayer(dice.filter((d) => !d.fx.rich));
  if (!rich) return plain;
  if (!plain) return rich;
  const object = new Group();
  object.add(plain.object, rich.object);
  return {
    object,
    own: [...plain.own, ...rich.own],
    update(t, progress, unit) {
      plain.update(t, progress, unit);
      rich.update(t, progress, unit);
    },
    land() {
      plain.land();
      rich.land();
    },
    active: () => rich.active(),
    clear() {
      plain.clear();
      rich.clear();
    },
  };
}

/** The subtle glow and motes (every type but fire and cold). */
function plainLayer(dice: readonly FxDie[]): FxLayer | null {
  if (dice.length === 0) return null;
  const map = new CanvasTexture(dotCanvas());
  map.colorSpace = SRGBColorSpace;
  const halo = pointsOf(dice.length, map);
  const motes = pointsOf(dice.length * MOTES, map);
  const object = new Group();
  object.add(halo.points, motes.points);
  const own: { dispose(): void }[] = [
    map,
    halo.geometry,
    halo.material,
    motes.geometry,
    motes.material,
  ];
  // Materials are shared between dice of one look: each glowing die gets its own.
  const glows = dice.map(({ mesh, fx }) => {
    const m = mesh.material.clone() as MeshStandardMaterial;
    m.emissive.setHex(fx.color);
    m.emissiveIntensity = 0;
    mesh.material = m;
    own.push(m);
    return m;
  });
  const haloRgb = dice.map(({ fx }) => new Color(fx.color));
  const moteRgb = dice.map(({ fx }) => new Color(fx.spark));
  const radius = dice.reduce((n, d) => n + d.radius, 0) / dice.length;
  return {
    object,
    own,
    update(t, progress, unit) {
      const env = fxEnvelope(progress);
      halo.material.size = Math.max(4, radius * unit * HALO_SIZE);
      motes.material.size = Math.max(2, radius * unit * MOTE_SIZE);
      dice.forEach(({ mesh, fx, radius: r }, k) => {
        const glow = fxGlow(fx, t, k);
        (glows[k] as MeshStandardMaterial).emissiveIntensity = glow * env;
        const { x, z } = mesh.position;
        const hc = haloRgb[k] as Color;
        halo.position.array.set([x, HALO_Y, z], k * 3);
        halo.color.array.set([hc.r, hc.g, hc.b, HALO_ALPHA * env * (0.5 + 0.5 * glow)], k * 4);
        const mc = moteRgb[k] as Color;
        for (let i = 0; i < MOTES; i++) {
          const m = fxMote(fx, k, i, t);
          const at = k * MOTES + i;
          motes.position.array.set([x + m.x * r, mesh.position.y + r * 1.2, z + m.y * r], at * 3);
          motes.color.array.set([mc.r, mc.g, mc.b, m.alpha * env], at * 4);
        }
      });
      for (const a of [halo.position, halo.color, motes.position, motes.color]) {
        a.needsUpdate = true;
      }
    },
    land() {
      this.clear();
    },
    active: () => false,
    clear() {
      object.visible = false;
      for (const m of glows) m.emissiveIntensity = 0;
    },
  };
}
