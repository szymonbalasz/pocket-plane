// Kit parity §6.11 (OQ-KIT-04 B): the DM stat-block window's pure parts. The window shows one
// creature (FR-KIT-102), bound to a combatant of the running encounter or to its definition
// (FR-KIT-104), and every button sends an existing intent (FR-KIT-105, -106): bound → combat's
// `cbt.attack` / `cbt.rollDamage` / `cbt.rollAbility` (as the Initiative row's Attack ▸ and
// Check ▸ / Save ▸); definition → plain `dice.roll`s as the creature. No new intent; 0 B.
import { attackRollSpecs } from "@shared/character-sheet/logic";
import { d20Expression } from "@shared/combat-tracker/rules";
import { CBT_INTENTS, COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import type { DiceRollIntent } from "@shared/dice-roll-log/schemas";
import { ABILITY_NAMES, type Ability, type Attack } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { manualFields } from "@ui/features/combat-tracker/roll-route";
import { startedIn } from "@ui/features/combat-tracker/store";
import { manualPartsOf, type RollRequest } from "@ui/features/dice-roll-log/roll-control";
import type { AttackAction } from "../../combat-tracker/attack-choices";

/** FR-KIT-100: the window type (DM registry only). */
export const STATBLOCK_KIND = "ent.statblock";

/**
 * What the window shows (client memory only, FR-KIT-100 / §8): the creature's definition, the
 * combatant it was opened on (FR-KIT-104) and, from the compendium, its entry (traits, type line).
 */
export interface StatBlockTarget {
  definitionId: string;
  combatantId?: string;
  entryId?: string;
}

/**
 * FR-KIT-104: the combatant the window is bound to: the target's, while it is an active,
 * non-removed combatant of the started encounter; else null (the window falls back to the
 * definition: no chip, plain rolls).
 */
export function boundCombatant(
  store: RecordStore,
  target: StatBlockTarget | null,
): CombatantView | null {
  if (!target?.combatantId) return null;
  const c = store.records[COMBATANT_TYPE]?.[target.combatantId] as CombatantView | undefined;
  const enc = startedIn(store);
  if (!c || !enc || c.encounterId !== enc.id) return null;
  return c.active === false || c.removed ? null : c;
}

/** One intent to send: its name and payload. */
export interface Send {
  name: string;
  payload: Record<string, unknown>;
}

/** The creature a roll is for: the bound combatant, else the definition by name. */
export type RollAs =
  | { combatantId: string; name: string }
  | { combatantId?: undefined; definitionId: string; name: string };

/** FR-KIT-105: the three attack buttons (kit order Attack, Damage, Attack + damage). */
export const ATTACK_BUTTONS = [
  { action: "toHit", label: "Attack", testId: "ent-statblock-roll-attack" },
  { action: "damage", label: "Damage", testId: "ent-statblock-roll-damage" },
  { action: "both", label: "Attack + damage", testId: "ent-statblock-roll-both" },
] as const satisfies readonly { action: AttackAction; label: string; testId: string }[];

/** The attack's to-hit and its damage parts as one expression (`dice.roll` takes one). */
export function plainAttackExpressions(attack: Attack): { hit: string; damage: string } {
  const [hit, ...damage] = attackRollSpecs({
    name: attack.name,
    toHit: attack.toHit,
    damage: attack.damage,
    damageType: attack.damageType ?? null,
    bonus: attack.bonus ?? 0,
    extraDamage: attack.extraDamage ?? [],
  });
  return { hit: hit.expression, damage: damage.map((s) => s.expression).join("+") };
}

const pub = (r: RollRequest) => (r.public !== undefined ? { public: r.public } : {});

/**
 * A plain `dice.roll` as the definition (FR-DICE-10 actor: the DM may roll as any creature).
 * Always `public: false` (K7 walkthrough F1 ruling 2026-10-27, ADR-0024 / FR-CHARX-22 over
 * FR-KIT-105): the definition's name could leak a hidden or renamed creature; the DM's category
 * presets don't apply here.
 */
function plainRoll(
  as: Extract<RollAs, { definitionId: string }>,
  expression: string,
  category: DiceRollIntent["category"],
  label: string,
  r: RollRequest,
  i: number,
  mode = r.mode,
): Send {
  const manual = r.manual?.[i];
  return {
    name: "dice.roll",
    payload: {
      expression,
      mode,
      category,
      label,
      actor: { entityId: as.definitionId },
      ...(manual ? { manual } : {}),
      public: false,
    },
  };
}

/**
 * FR-KIT-105: what one attack button sends, from the roll control's request. Bound: as the
 * Initiative row's Attack ▸ (FR-CBT-74): Attack → `cbt.attack {rolls: "toHit"}`, Damage →
 * `cbt.rollDamage`, Attack + damage → `cbt.attack`; `attackId` absent = the first attack (a
 * legacy row without id, FR-CHARX-20). Definition: `dice.roll` labelled "<name> — <attack>
 * attack / damage"; Attack + damage = the to-hit roll, then the damage roll (two entries, no card).
 */
export function attackSends(
  as: RollAs,
  attack: Attack,
  attackId: string | undefined,
  action: AttackAction,
  r: RollRequest,
): Send[] {
  if (as.combatantId !== undefined) {
    const ref = attackId ? { attackId } : {};
    const manual = manualFields(r, action === "damage" ? 1 : 2);
    if (action === "damage") {
      return [
        {
          name: CBT_INTENTS.rollDamage,
          payload: { attackerId: as.combatantId, ...manual, ...ref },
        },
      ];
    }
    return [
      {
        name: CBT_INTENTS.attack,
        payload: {
          attackerId: as.combatantId,
          mode: r.mode,
          ...(action === "toHit" ? { rolls: "toHit" } : {}),
          ...manual,
          ...ref,
        },
      },
    ];
  }
  const x = plainAttackExpressions(attack);
  const label = (what: string) => `${as.name} — ${attack.name} ${what}`;
  const hit = plainRoll(as, x.hit, "attack", label("attack"), r, 0);
  if (action === "toHit") return [hit];
  const damage = (i: number) => plainRoll(as, x.damage, "damage", label("damage"), r, i, "normal");
  return action === "damage" ? [damage(0)] : [hit, damage(1)];
}

/** FR-KIT-105: the control's expressions for a definition's attack button (bound: combat's). */
export function plainAttackRolls(attack: Attack, action: AttackAction): string[] {
  const x = plainAttackExpressions(attack);
  return action === "toHit" ? [x.hit] : action === "damage" ? [x.damage] : [x.hit, x.damage];
}

export type AbilityKind = "check" | "save";

/**
 * FR-KIT-106: an ability's Check / Save. Bound → `cbt.rollAbility {combatantId, kind, ability}`
 * (as Initiative ⋯ Check ▸ / Save ▸); definition → `dice.roll` (`ability-check` /
 * `saving-throw`), d20 + the bonus.
 */
export function abilitySend(
  as: RollAs,
  kind: AbilityKind,
  ability: Ability,
  bonus: number,
  r: RollRequest,
): Send {
  if (as.combatantId !== undefined) {
    return {
      name: CBT_INTENTS.rollAbility,
      payload: {
        combatantId: as.combatantId,
        kind,
        ability,
        mode: r.mode,
        ...(r.manual ? { manual: r.manual[0] } : {}),
        ...manualPartsOf(r),
        ...pub(r),
      },
    };
  }
  return plainRoll(
    as,
    d20Expression(bonus),
    kind === "check" ? "ability-check" : "saving-throw",
    abilityLabel(as.name, kind, ability),
    r,
    0,
  );
}

export const abilityLabel = (name: string, kind: AbilityKind, a: Ability) =>
  `${name} — ${ABILITY_NAMES[a]} ${kind}`;

/** FR-KIT-103: "Small humanoid (goblinoid), neutral evil" from what is known. */
export function typeLine(parts: {
  size: string;
  type?: string | null;
  subtype?: string | null;
  alignment?: string | null;
}): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const kind = [cap(parts.size), parts.type ?? null].filter(Boolean).join(" ");
  const sub = parts.type && parts.subtype ? ` (${parts.subtype})` : "";
  return `${kind}${sub}${parts.alignment ? `, ${parts.alignment}` : ""}`;
}

/** FR-KIT-103 empty state copy. */
export const EMPTY_TEXT = "Pick a creature: Initiative ⋯, a token, or the compendium";
