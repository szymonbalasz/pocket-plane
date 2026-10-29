// DM Initiative row attack picker (OQ-CHARX-12, FR-CHARX-24): which of a definition's attacks
// `cbt.attack` can name, and what one action of it rolls (FR-CBT-74, -81, -83). Pure. Sprint 15
// (FR-CBT-169): two actions, Attack and Damage, whose controls stage the Dice tray on click.
import { attackRollSpecs } from "@shared/character-sheet/logic";
import { rowPartTypes } from "@shared/character-sheet/rolls";
import { critExpression } from "@shared/combat-tracker/rules";
import { CBT_INTENTS, type DamageCardPayload } from "@shared/combat-tracker/schemas";
import type { RollMode } from "@shared/dice-roll-log/schemas";
import type { PartDamageType, RollSubject } from "@shared/effect-modifiers/schemas";
import type { Attack } from "@shared/entities/schemas";
import { attackRowView } from "@ui/features/character-sheet/view-model";
import { manualFields, partsOf } from "@ui/features/combat-tracker/roll-route";
import { slotLabelsOf } from "@ui/features/dice-roll-log/logic";
import type { RollControlOptions, RollRequest } from "@ui/features/dice-roll-log/roll-control";

/**
 * Attack ▸'s second line, as the sheet and the companion card show the row (walkthrough fix):
 * "+6 · 1d6+4 piercing + 1d6 fire" (magic bonus folded in, every extra damage part).
 */
export const attackSummary = (a: Attack): string => attackRowView(a).parts.join(" ");

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

/**
 * The two actions (FR-CBT-169, #385): Attack (`cbt.attack {rolls: "toHit"}`), Damage
 * (`cbt.rollDamage`); Attack + damage is gone.
 */
export type AttackAction = "toHit" | "damage";

/** FR-CBT-169: the actions in menu / button order (Initiative Attack ▸, the kit stat block). */
export const ATTACK_ACTIONS = [
  { value: "toHit", label: "Attack" },
  { value: "damage", label: "Damage" },
] as const satisfies readonly { value: AttackAction; label: string }[];

export interface AttackRolls {
  /** The to-hit, or the base part then the extra parts: the roll control's expressions. */
  expressions: string[];
  /** One per damage part (FR-CBT-83: a crit doubles every part); none for Attack. */
  critExpressions?: string[];
  /** Damage parts after the base part (their slots have no roll subject, FR-CHARX-55). */
  extraParts: number;
  /** FR-DICE-41: one per expression ("Slashing", "Fire"); none for Attack. */
  slotLabels?: (string | null)[];
  /** FR-DICE-98: one damage type per part (the tray's die groups); none for Attack. */
  partTypes?: (PartDamageType | null)[];
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
  if (action === "toHit") return { expressions: [hitSpec.expression], extraParts: 0 };
  const damage = damageSpecs.map((s) => s.expression);
  return {
    expressions: damage,
    critExpressions: damage.map(critExpression),
    extraParts: damage.length - 1,
    slotLabels: slotLabelsOf(damageSpecs) ?? [],
    partTypes: rowPartTypes(damageSpecs, attack.damageType),
  };
}

/**
 * FR-MOD-15, -27: the preview subjects of an attack row's action, as `cbt.attack` /
 * `cbt.rollDamage` roll them: the to-hit, or the card's damage (`card: true`, reading the pending
 * to-hit card's mode); an extra damage part has none (FR-CHARX-55).
 */
export function attackSubjects(
  combatantId: string,
  row: string,
  action: AttackAction,
  cardMode: RollMode | undefined,
  extraParts: number,
): (RollSubject | null)[] {
  const base = { creature: { combatantId }, via: "weapon" as const, row: row.slice(0, 60) };
  const hit: RollSubject = { ...base, roll: "attack" };
  const damage: RollSubject = {
    ...base,
    roll: "damage",
    card: true,
    ...(cardMode ? { toHitMode: cardMode } : {}),
  };
  return action === "toHit" ? [hit] : [damage, ...Array<null>(extraParts).fill(null)];
}

/** An attack rolled in a fight: the attacker and the pending to-hit card Damage completes. */
export interface AttackCombat {
  combatantId: string;
  /** FR-CBT-74: the row's latest pending to-hit-only card (its mode; a natural 20 = crit). */
  card: DamageCardPayload | null;
}

/**
 * FR-CBT-169 (FR-DICE-98, #385): one action's roll control options (`onRoll` aside): the dice as
 * `cbt.attack` / `cbt.rollDamage` (or a definition's `dice.roll`) roll them, labelled "<name> —
 * <attack> attack / damage", with its `purpose` and a damage type per part, so a click stages the
 * Dice tray pre-filled and Alt+click rolls at once. In a fight (`combat`): the crit dice, `crit`
 * after a natural 20 on the pending to-hit card, and the effect-modifier preview subjects.
 */
export function attackControlOptions(
  name: string,
  attack: Attack,
  action: AttackAction,
  combat?: AttackCombat,
): Omit<RollControlOptions, "onRoll"> {
  const rolls = attackRolls(attack, action);
  const what = action === "damage" ? "damage" : "attack";
  return {
    expressions: rolls.expressions,
    category: what,
    label: `${name} — ${attack.name} ${what}`,
    purpose: what,
    ...(rolls.partTypes ? { partTypes: rolls.partTypes } : {}),
    // FR-DICE-41: "Slashing", "Fire" in the physical form and the tray.
    ...(rolls.slotLabels ? { slotLabels: rolls.slotLabels } : {}),
    ...(combat
      ? {
          ...(rolls.critExpressions ? { critExpressions: rolls.critExpressions } : {}),
          ...(action === "damage" && combat.card?.toHit?.natural === 20 ? { crit: true } : {}),
          subject: attackSubjects(
            combat.combatantId,
            attack.name,
            action,
            combat.card?.mode,
            rolls.extraParts,
          ),
        }
      : {}),
  };
}

/**
 * FR-CBT-169, -170: one action's combat intent from the roll control's request: Attack →
 * `cbt.attack {rolls: "toHit"}`, Damage → `cbt.rollDamage` (one entry, then the extra parts as
 * `manualExtra`), with the tray's staged `parts` (absent on Alt+click). `attackId` absent = the
 * first attack (a legacy row without id, FR-CHARX-20).
 */
export function attackIntent(
  attackerId: string,
  attackId: string | undefined,
  action: AttackAction,
  r: RollRequest,
): { name: string; payload: Record<string, unknown> } {
  const ref = attackId ? { attackId } : {};
  if (action === "damage") {
    return {
      name: CBT_INTENTS.rollDamage,
      payload: { attackerId, ...manualFields(r, 1), ...ref, ...partsOf(r) },
    };
  }
  return {
    name: CBT_INTENTS.attack,
    payload: {
      attackerId,
      mode: r.mode,
      rolls: "toHit",
      ...manualFields(r, 2),
      ...ref,
      ...partsOf(r),
    },
  };
}
