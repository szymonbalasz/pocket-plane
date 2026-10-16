// FR-MOD-25 for a typed trigger part's chip (R7): the multiplier the row's defenses preset for
// the part's own damage type (R2's `defensePreset`): radiant Divine Fury on a raging Brakka is
// Normal while her slashing row is Half.
import type { EffectView } from "@shared/combat-extras/schemas";
import type { DamageMultiplier } from "@shared/combat-tracker/schemas";
import { defensePreset } from "@shared/effect-modifiers/target-facts";
import type { PopupRowView } from "../combat-tracker/popup-parts";

export function defenseMultiplier(
  effects: readonly EffectView[],
  row: PopupRowView,
  type: string,
): DamageMultiplier | null {
  const c = row.combatant;
  const target = { id: row.targetId, kind: c.kind, entityId: c.entityId ?? null };
  return defensePreset(effects, target, type)?.multiplier ?? null;
}
