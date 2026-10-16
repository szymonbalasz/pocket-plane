// FR-MOD-25 for a typed trigger part's chip (R7): the multiplier the row's defenses preset for
// the part's own damage type ("radiant" Divine Fury on a raging Brakka: Normal; slashing: Half).
import type { EffectView } from "@shared/combat-extras/schemas";
import type { DamageMultiplier } from "@shared/combat-tracker/schemas";
import { DEFENSE_MULTIPLIER, defenseFor } from "@shared/effect-modifiers/rules";
import type { PopupRowView } from "../combat-tracker/popup-parts";

export function defenseMultiplier(
  effects: readonly EffectView[],
  row: PopupRowView,
  type: string,
): DamageMultiplier | null {
  const c = row.combatant;
  const creature =
    c.kind === "pc" && c.entityId ? { characterId: c.entityId } : { combatantId: row.targetId };
  const d = defenseFor(effects, creature, type);
  return d ? DEFENSE_MULTIPLIER[d.level] : null;
}
