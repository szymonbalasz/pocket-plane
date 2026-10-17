// FR-DICEX-33 / -34 / -44: arena and die size from a rect in CSS px, pure (the headless
// simulation in the lazy chunk and the dice layer both use it). The world size comes from the
// rect rounded to 50 px, so equal (or near-equal) viewports run the same simulation for a seed;
// other shapes take another path to the same faces.

export interface Size {
  w: number;
  h: number;
}

/** Arena half extents in world units (floor + four walls on its edges). */
export interface Arena {
  x: number;
  z: number;
}

/** FR-DICEX-33: die size = 7 % of the viewport's short side, clamped 40–96 px. */
export const DIE_SIZE = { share: 0.07, min: 40, max: 96 } as const;
/** World units one die size spans (a d20's circumradius is 0.68). */
export const DIE_WORLD = 1.3;
/** FR-DICEX-34: the arena's world size comes from the rect rounded to this. */
export const ARENA_SNAP_PX = 50;
/** FR-DICEX-44: the dice layer's pixel ratio cap and the shadow budget (CSS px). */
export const MAX_PIXEL_RATIO = 1.5;
export const SHADOW_MAX_PX = 2_500_000;

export function dieSizePx(viewport: Size): number {
  const px = Math.round(DIE_SIZE.share * Math.min(viewport.w, viewport.h));
  return Math.min(DIE_SIZE.max, Math.max(DIE_SIZE.min, px));
}

const snap = (px: number) =>
  Math.max(ARENA_SNAP_PX, Math.round(px / ARENA_SNAP_PX) * ARENA_SNAP_PX);

/** The arena of a `rect` with dice `diePx` wide. */
export function arenaOf(rect: Size, diePx: number): Arena {
  const perUnit = diePx / DIE_WORLD;
  return { x: snap(rect.w) / 2 / perUnit, z: snap(rect.h) / 2 / perUnit };
}

/** FR-DICEX-33: the screen arena = the viewport, walls on its edges. */
export const screenArena = (viewport: Size): Arena => arenaOf(viewport, dieSizePx(viewport));

/** FR-DICEX-44: the renderer's pixel ratio. */
export const pixelRatioOf = (devicePixelRatio: number) =>
  Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO);

/** FR-DICEX-44: no shadows above 2.5 MP of viewport. */
export const shadowsFor = (viewport: Size) => viewport.w * viewport.h <= SHADOW_MAX_PX;
