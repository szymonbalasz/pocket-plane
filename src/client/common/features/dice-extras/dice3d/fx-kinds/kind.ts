// FR-DICEX-106: what one damage type's full 3D effect is made of. Each kind fills in a
// `RichKindDef` in its own fx-kinds/<kind>.ts; fx-rich.ts draws them all the same way (one atlas,
// one additive and one covering particle draw, an aura quad per die, the die's glow, extras), in
// the throw's loop and for the landing only. Rules for every kind:
// - The landing is over by LAND_S after rest (fx-sim.ts), before the hand-off (FR-DICEX-35): the
//   layer clears and hides everything then, extras included.
// - Particles share the kind's budget (`budgetScale`, MAX_PARTICLES); extras stay cheap (built once
//   per throw, a handful of objects per die, no new geometry per frame).
// - Deterministic: randomness only from the `seed` given (fx-sim.ts `prng`), never Math.random.
// - A miniature (onStill) lands clean: `clear()` comes right at rest and must leave nothing.
import type { Mesh, Object3D } from "three";
import type { RichPreset } from "../fx-sim";

/** Draws one sprite, white on transparent (particles tint it), in a `px` × `px` cell at 0, 0. */
export type TileDraw = (g: CanvasRenderingContext2D, px: number) => void;

/** A shader quad around each die, flat on the floor plane under the camera. */
export interface RichAura {
  /** Fragment shader: start with AURA_HEAD and AURA_SHAPE (shaders.ts); additive blending. */
  frag: string;
  /** Half size in die radii. */
  size: number;
}

/** A die as an extra sees it: read `mesh.position` each update (it moves). */
export interface ExtraDie {
  mesh: Mesh;
  radius: number;
}

/** Custom three.js objects a sprite can't do (a slash streak, bolts, shockwave rings, a cloud). */
export interface RichExtra {
  /** Added to the layer once; hidden with it at clear. */
  object: Object3D;
  /**
   * Each frame: `t` seconds since the throw started, `progress` (0–1, 1 after rest), `unit` CSS px
   * per world unit, `sinceRest` seconds since the landing (null in flight). With `whileRolling`
   * false it is called from the landing on only.
   */
  update(t: number, progress: number, unit: number, sinceRest: number | null): void;
  /** The dice rest (once): start the landing; the next update has `sinceRest` 0. */
  land(): void;
  /** Optional: put back anything changed on the dice (materials); the layer hides `object`. */
  clear?(): void;
  /** Free geometries, materials and textures (the throw is released). */
  dispose(): void;
}

export interface RichKindDef {
  /** Particle species, emitters and the die's glow (fx-sim.ts). */
  preset: RichPreset;
  /**
   * The kind's own sprites, by name (species pick one by `tile`). One atlas per throw holds the
   * core tiles and those of the kinds in it; one name = one sprite across kinds (poison and
   * necrotic may share "skull"), so give a kind-only sprite a kind-specific name.
   */
  tiles?: Readonly<Record<string, TileDraw>>;
  aura?: RichAura;
  /** False: no particles, aura, glow or extra in flight; only the landing (physical types). */
  whileRolling: boolean;
  /** One per kind per throw, for that kind's dice. */
  extra?: (dice: readonly ExtraDie[], seed: number) => RichExtra;
}
