// Hit cue (FR-VFX-19–22, ADR-0071): the transient server signal `vfx.hit`, one per applied target
// row, never stored, logged or in a snapshot; and the pure look choice `hitLooks(cue)`.
import { PartDamageType } from "@shared/effect-modifiers/schemas";
import { DAMAGE_TYPES } from "@shared/entities/schemas";
import { DamageMultiplier } from "@shared/events/combat-tracker";
import { z } from "zod";

/** Server signal name of a hit cue (protocol: server-sent transient message). */
export const VFX_HIT_SIGNAL = "vfx.hit";
/** FR-VFX-21: at most four typed parts per cue. */
export const HIT_CUE_PARTS_MAX = 4;

const Id = z.string().min(1).max(64);

export const HitCuePart = z.strictObject({
  type: PartDamageType.nullable(),
  value: z.int().min(0),
});
export type HitCuePart = z.infer<typeof HitCuePart>;

/**
 * FR-VFX-21: `id` = the applied `hp_change` row id (unique per target row; seeds the look's PRNG,
 * FR-VFX-14). `attackerTokenId` only for a receiver who has the attacker's token.
 */
export const HitCue = z.strictObject({
  id: Id,
  targetTokenId: Id,
  attackerTokenId: Id.optional(),
  kind: z.enum(["damage", "heal"]),
  parts: z.array(HitCuePart).max(HIT_CUE_PARTS_MAX),
  multiplier: DamageMultiplier,
  crit: z.boolean(),
});
export type HitCue = z.infer<typeof HitCue>;

/** FR-VFX-18: one hit look per key: the 13 damage types, healing, untyped, glance. */
export const HIT_LOOK_KEYS = [...DAMAGE_TYPES, "healing", "untyped", "glance"] as const;
export type HitLookKey = (typeof HIT_LOOK_KEYS)[number];

export interface HitLookPick {
  key: HitLookKey;
  /** FR-VFX-19: half × 0.7, double × 1.3, crit × 1.2 (stacked). */
  scale: number;
}

const MULT_SCALE: Record<DamageMultiplier, number> = {
  normal: 1,
  half: 0.7,
  none: 1,
  double: 1.3,
};

/**
 * FR-VFX-19 / -20 (pure): heal → `healing`; damage with `multiplier: none` → `glance`; else the
 * two largest typed parts (summed per type, by value, ties in cue order), each its type's look;
 * no typed part → `untyped`. Nothing applied (every part 0) → no look.
 */
export function hitLooks(cue: HitCue): HitLookPick[] {
  const crit = cue.crit ? 1.2 : 1;
  if (cue.kind === "heal") {
    return cue.parts.some((p) => p.value > 0) ? [{ key: "healing", scale: 1 }] : [];
  }
  if (cue.multiplier === "none") return [{ key: "glance", scale: crit }];
  const scale = Math.round(MULT_SCALE[cue.multiplier] * crit * 100) / 100;
  const byType = new Map<string, number>();
  let any = false;
  for (const p of cue.parts) {
    if (p.value <= 0) continue;
    any = true;
    if (p.type !== null) byType.set(p.type, (byType.get(p.type) ?? 0) + p.value);
  }
  if (!any) return [];
  const typed = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (typed.length === 0) return [{ key: "untyped", scale }];
  return typed.map(([key]) => ({ key: key as HitLookKey, scale }));
}
