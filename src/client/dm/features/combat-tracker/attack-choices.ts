// DM Initiative row attack picker (OQ-CHARX-12, FR-CHARX-24): which of a definition's attacks
// `cbt.attack` can name, and what one action of it rolls (FR-CBT-74, -81, -83). Pure.
import { attackRollSpecs } from "@shared/character-sheet/logic";
import { critExpression } from "@shared/combat-tracker/rules";
import type { Attack } from "@shared/entities/schemas";
import { slotLabelsOf } from "@ui/features/dice-roll-log/logic";

export interface AttackChoice {
  attack: Attack;
  /** Sent as `cbt.attack`'s `attackId`; absent = the first attack (a legacy row without id). */
  attackId?: string;
}

/**
 * The first attack always (by id when it has one, else as "the first attack"); every later one
 * only with an id, since `cbt.attack` names rows by id (legacy rows get one on the first sheet
 * write, FR-CHARX-16). One choice or none → a plain Attack button, no picker.
 */
export function attackChoices(attacks: readonly Attack[]): AttackChoice[] {
  return attacks.flatMap((attack, i) => {
    if (attack.id !== undefined) return [{ attack, attackId: attack.id }];
    return i === 0 ? [{ attack }] : [];
  });
}

/** The three N7 actions (FR-CBT-74): Attack + damage, Attack, Damage. */
export type AttackAction = "both" | "toHit" | "damage";

export interface AttackRolls {
  /** [to-hit,] base part, extra parts…: the roll control's expressions. */
  expressions: string[];
  /** One per damage part (FR-CBT-83: a crit doubles every part); none for Attack alone. */
  critExpressions?: string[];
  /** Damage parts after the base part (their slots have no roll subject, FR-CHARX-55). */
  extraParts: number;
  /** FR-DICE-41: one per expression ("To hit", "Slashing", "Fire"); none for Attack alone. */
  slotLabels?: (string | null)[];
}

/**
 * FR-CBT-81, -83 (BL-19): an action's rolls as `cbt.attack` / `cbt.rollDamage` build them
 * (`attackRollSpecs`): to-hit and the base part carry the weapon's `bonus`, then each extra part,
 * so a physical entry fits each part the server rolls.
 */
export function attackRolls(attack: Attack, action: AttackAction): AttackRolls {
  const [hitSpec, ...damageSpecs] = attackRollSpecs({
    name: attack.name,
    toHit: attack.toHit,
    damage: attack.damage,
    damageType: attack.damageType ?? null,
    bonus: attack.bonus ?? 0,
    extraDamage: attack.extraDamage ?? [],
  });
  const hit = hitSpec.expression;
  const damage = damageSpecs.map((s) => s.expression);
  if (action === "toHit") return { expressions: [hit], extraParts: 0 };
  const critExpressions = damage.map(critExpression);
  const extraParts = damage.length - 1;
  const specs = action === "damage" ? damageSpecs : [hitSpec, ...damageSpecs];
  const slotLabels = slotLabelsOf(specs) ?? [];
  return action === "damage"
    ? { expressions: damage, critExpressions, extraParts, slotLabels }
    : { expressions: [hit, ...damage], critExpressions, extraParts, slotLabels };
}
