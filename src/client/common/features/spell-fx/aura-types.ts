// Aura renderer contract (FR-VFX-13–17, ADR-0071): one renderer per FX preset, drawing an aura's
// under pass (below tokens) and over pass (above tokens, below labels) on the `objects` layer's
// 2D context, in map px. A renderer keeps its particles in its own state, seeded by the effect id
// (FR-VFX-14); time comes from the one FX clock. DOM-free.
import type { FxParamsOut } from "@shared/spell-fx/presets";
import type { FxLevel } from "./prefs";

/** The level an aura draws at (Off draws nothing, so never reaches a renderer). */
export type DrawLevel = Exclude<FxLevel, "off">;

/** FR-VFX-17: how much a covering aura hides its token for this viewer. */
export type Cover = "eyes" | "half";

export interface AuraFrame {
  /** The anchor token's drawn centre (map px), lagged by the engine at Full / Reduced. */
  x: number;
  y: number;
  /** Footprint side (map px). */
  size: number;
  /** Map px per 5 ft (one grid cell). */
  cell: number;
  /** Emanation edge from the centre: `radiusFt / 5 × cell + size / 2` (map px). */
  radius: number;
  /** FX clock, seconds; the Still frame uses a fixed time. */
  t: number;
  level: DrawLevel;
  /** Pass opacity (DM: hidden token → the hidden-token opacity). */
  alpha: number;
  cover: Cover;
}

/** A visual-only reaction (FR-VFX-15, -16) toward another token's drawn centre. */
export interface AuraReaction {
  kind: "strike" | "lash";
  toX: number;
  toY: number;
  /** Seconds since it started. */
  age: number;
}

export interface AuraInstance {
  /** Live particles now (FR-VFX-29 budget). */
  particles(level: DrawLevel): number;
  /** Advances particle state by `dt` seconds toward the anchor at (x, y). */
  step(dt: number, f: AuraFrame): void;
  /** Snaps every particle to the anchor (Still frames, first frame, scene change). */
  reset(f: AuraFrame): void;
  under(ctx: CanvasRenderingContext2D, f: AuraFrame): void;
  over(ctx: CanvasRenderingContext2D, f: AuraFrame, reactions: readonly AuraReaction[]): void;
}

export interface AuraRenderer {
  /** The preset key (`presets.ts`). */
  preset: string;
  /** Seconds a reaction plays. */
  reactionSeconds: number;
  /** FR-VFX-12: the preset's own lag behind its token's drawn position, seconds. */
  lagSeconds: number;
  create(seed: string, params: FxParamsOut): AuraInstance;
}

/** The Still frame's clock time: a pure function of (seed, params, position), FR-VFX-14. */
export const STILL_T = 1.25;

/** Smooth step 0 → 1. */
export const ease = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));

/** Exponential approach factor for a lag of `seconds` over `dt`. */
export const follow = (dt: number, seconds: number) =>
  seconds <= 0 ? 1 : 1 - Math.exp(-dt / seconds);
