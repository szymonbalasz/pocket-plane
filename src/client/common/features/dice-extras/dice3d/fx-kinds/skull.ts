// FR-DICEX-106: the skull poison and necrotic dice share (DM, 2026-11-06). One sprite drawing,
// `skull`, and one extra that floats a few skulls per die: upright sprites (particles turn at
// random, a skull must not), each with a soft halo behind it that glows through its eye holes.
// Poison's rise from the die with the fumes; necrotic's circle it. On landing they fly outward
// and are gone well before LAND_S.
import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  NormalBlending,
  Sprite,
  SpriteMaterial,
} from "three";
import { budgetScale, prng } from "../fx-sim";
import type { ExtraDie, RichExtra, TileDraw } from "./kind";
import { soft, TILE_PX } from "./tiles";

/** A skull, white, facing the viewer; eyes, nose and the gaps between the teeth are holes. */
export const skull: TileDraw = (g, px) => {
  const h = px / 2;
  g.save();
  g.fillStyle = "rgba(255,255,255,1)";
  g.beginPath();
  // Cranium and cheekbones.
  g.ellipse(h, h * 0.82, h * 0.62, h * 0.6, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(h, h * 1.14, h * 0.5, h * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  // Jaw.
  g.beginPath();
  g.roundRect(h - h * 0.34, h * 1.18, h * 0.68, h * 0.46, h * 0.14);
  g.fill();
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "rgba(0,0,0,1)";
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(h + side * h * 0.26, h * 0.92, h * 0.18, h * 0.2, side * -0.25, 0, Math.PI * 2);
    g.fill();
  }
  // Nose.
  g.beginPath();
  g.moveTo(h, h * 1.1);
  g.lineTo(h - h * 0.08, h * 1.28);
  g.lineTo(h + h * 0.08, h * 1.28);
  g.closePath();
  g.fill();
  // Teeth.
  g.lineWidth = Math.max(1, h * 0.05);
  g.strokeStyle = "rgba(0,0,0,1)";
  g.beginPath();
  g.moveTo(h - h * 0.3, h * 1.44);
  g.lineTo(h + h * 0.3, h * 1.44);
  for (const x of [-0.2, -0.07, 0.07, 0.2]) {
    g.moveTo(h + x * h, h * 1.36);
    g.lineTo(h + x * h, h * 1.6);
  }
  g.stroke();
  g.restore();
};

export interface SkullStyle {
  /** The skull's colour (multiplies the white sprite). */
  color: number;
  /** The halo behind it (additive): glows round it and through its eyes. */
  halo: number;
  /** Skulls per die (before the budget). */
  per: number;
  /** Rise from the die and fade (poison), or circle it (necrotic). */
  motion: "rise" | "orbit";
  /** Skull height in die radii. */
  size: number;
}

/** The landing: skulls fly out over this long, then stay gone. */
const FLY_S = 0.55;

function canvasOf(draw: (g: CanvasRenderingContext2D, px: number) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE_PX;
  c.height = TILE_PX;
  const g = c.getContext("2d");
  if (g) draw(g, TILE_PX);
  return c;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Skull {
  die: ExtraDie;
  /** Index among its die's skulls. */
  i: number;
  of: number;
  phase: number;
  face: Sprite;
  glow: Sprite;
  /** Its offset from the die at the landing (die radii), and the way it flies. */
  at: { x: number; z: number; s: number; o: number } | null;
}

/** The skulls of one kind's dice in a throw. */
export function skullExtra(dice: readonly ExtraDie[], seed: number, style: SkullStyle): RichExtra {
  const object = new Group();
  const faceMap = new CanvasTexture(canvasOf(skull));
  const glowMap = new CanvasTexture(canvasOf((g, px) => soft(g, px / 2, px / 2, px / 2, 1)));
  const faceMat = new SpriteMaterial({
    map: faceMap,
    color: style.color,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });
  const glowMat = new SpriteMaterial({
    map: glowMap,
    color: style.halo,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const mats: SpriteMaterial[] = [faceMat, glowMat];
  const rand = prng(seed);
  const per = Math.max(1, Math.round(style.per * budgetScale(dice.length)));
  const skulls: Skull[] = [];
  for (const die of dice) {
    for (let i = 0; i < per; i++) {
      // Each skull its own material clones: opacity per skull.
      const fm = faceMat.clone();
      const gm = glowMat.clone();
      mats.push(fm, gm);
      const face = new Sprite(fm);
      const glow = new Sprite(gm);
      face.renderOrder = 5;
      glow.renderOrder = 4;
      face.frustumCulled = false;
      glow.frustumCulled = false;
      object.add(glow, face);
      skulls.push({ die, i, of: per, phase: rand(), face, glow, at: null });
    }
  }
  /** A stable random number for skull `k`'s cycle `c`. */
  const pick = (k: number, c: number, salt: number) =>
    prng((seed * 7919 + k * 104729 + c * 1299709 + salt * 15485863) >>> 0)();

  /** Where skull `k` is at `t` in flight: offset (die radii), scale, opacity, tilt. */
  const flying = (s: Skull, k: number, t: number) => {
    if (style.motion === "rise") {
      // A cycle: born at the die's rim, rising and swelling, fading out.
      const period = 1.25;
      const u0 = t / period + s.phase + s.i / s.of;
      const c = Math.floor(u0);
      const u = u0 - c;
      const a = pick(k, c, 1) * Math.PI * 2;
      const side = Math.cos(a);
      const x = side * 0.75 + Math.sin(u * 5 + a) * 0.18;
      const z = Math.sin(a) * 0.45 + 0.1 - u * 2.1;
      const o = smooth(0, 0.18, u) * (1 - smooth(0.6, 1, u));
      return { x, z, s: 0.6 + 0.55 * u, o, tilt: side * 0.25 + Math.sin(u * 4 + a) * 0.12 };
    }
    // Circling the die, fading in and out of sight.
    const a = s.phase * Math.PI * 2 + (s.i / s.of) * Math.PI * 2 + t * 2.1;
    const rr = 1.55 + 0.12 * Math.sin(t * 3 + s.i * 2);
    const o = 0.8 + 0.2 * Math.sin(t * 4.3 + s.phase * 9);
    return {
      x: Math.cos(a) * rr,
      z: Math.sin(a) * rr * 0.85,
      s: 0.9 + 0.12 * Math.sin(t * 5 + s.i),
      o,
      tilt: Math.sin(t * 2.7 + s.i) * 0.2,
    };
  };

  const place = (s: Skull, x: number, z: number, scale: number, o: number, tilt: number) => {
    const { mesh, radius: r } = s.die;
    const { position: p } = mesh;
    const size = r * style.size * scale;
    s.face.position.set(p.x + x * r, p.y + r * 1.4, p.z + z * r);
    s.glow.position.set(p.x + x * r, p.y + r * 1.35, p.z + z * r);
    s.face.scale.set(size, size, 1);
    s.glow.scale.set(size * 1.9, size * 1.9, 1);
    s.face.material.opacity = o;
    s.glow.material.opacity = o * 0.85;
    s.face.material.rotation = tilt;
    s.glow.material.rotation = tilt;
  };

  let landed = false;
  return {
    object,
    update(t, progress, _unit, sinceRest) {
      const inAmp = Math.min(1, progress / 0.06);
      skulls.forEach((s, k) => {
        if (sinceRest === null) {
          const f = flying(s, k, t);
          place(s, f.x, f.z, f.s, f.o * inAmp, f.tilt);
          return;
        }
        if (!landed) return;
        // The landing: each flies straight out from where it was, swelling, and fades.
        if (!s.at) {
          const f = flying(s, k, t);
          s.at = { x: f.x, z: f.z, s: f.s, o: f.o };
        }
        const u = Math.min(1, sinceRest / FLY_S);
        const len = Math.max(0.3, Math.hypot(s.at.x, s.at.z));
        const out = 1 + (1 - (1 - u) * (1 - u)) * 1.6;
        const o = Math.max(s.at.o, 0.6) * (1 - u) * (1 - u) * (u < 1 ? 1 : 0);
        const dx = (s.at.x / len) * (len * out - len) + s.at.x;
        const dz = (s.at.z / len) * (len * out - len) + s.at.z;
        place(s, dx, dz, s.at.s * (1 + 0.5 * u), o, 0);
      });
    },
    land() {
      landed = true;
    },
    clear() {
      for (const s of skulls) {
        s.face.material.opacity = 0;
        s.glow.material.opacity = 0;
      }
    },
    dispose() {
      faceMap.dispose();
      glowMap.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
