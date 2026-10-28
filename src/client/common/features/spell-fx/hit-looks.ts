// Hit look registry (FR-VFX-18, ADR-0071). APPEND-ONLY (AGENTS §9.9): one look per key of
// `HIT_LOOK_KEYS` (the 13 damage types, `healing`, `untyped`, `glance`), one import and one line
// each. Created empty with its type by fix/vfx-core; spell-fx's build fills it (and its test then
// requires every key). A look draws on the `vfx-over` pass within 1.6 × the token's footprint,
// lasts 0.4–1.4 s, and is subtle: no screen flash, no camera move.
import type { HitLookKey } from "@shared/spell-fx/cue";
import { LOOKS } from "./looks";

/** What a look draws from: the target's drawn box, the aim, the cue's PRNG seed and scale. */
export interface HitLookFrame {
  /** Target token's drawn centre and footprint side (display px). */
  x: number;
  y: number;
  size: number;
  /** Radians from the attacker's centre to the target's; seeded random when no attacker. */
  angle: number;
  /** FR-VFX-19 scale (half 0.7, double 1.3, crit 1.2, stacked). */
  scale: number;
  /** FR-VFX-14: deterministic randomness seeded by the cue id. */
  random: () => number;
  /** Seconds since the look started. */
  t: number;
}

export interface HitLook {
  key: HitLookKey;
  /** Seconds, 0.4–1.4 (FR-VFX-18). */
  duration: number;
  /** Draws one frame on the over pass's 2D context; `t` runs 0 → `duration`. */
  draw(ctx: CanvasRenderingContext2D, f: HitLookFrame): void;
}

export const hitLooks: Partial<Record<HitLookKey, HitLook>> = {
  acid: LOOKS.acid, // spell-fx build (VFX §7.2)
  bludgeoning: LOOKS.bludgeoning,
  cold: LOOKS.cold,
  fire: LOOKS.fire,
  force: LOOKS.force,
  lightning: LOOKS.lightning,
  necrotic: LOOKS.necrotic,
  piercing: LOOKS.piercing,
  poison: LOOKS.poison,
  psychic: LOOKS.psychic,
  radiant: LOOKS.radiant,
  slashing: LOOKS.slashing,
  thunder: LOOKS.thunder,
  healing: LOOKS.healing,
  untyped: LOOKS.untyped,
  glance: LOOKS.glance,
};
