// Kit parity §6.11 (OQ-KIT-04 B): the DM stat-block window's pure parts. The window shows one
// creature (FR-KIT-102), bound to a combatant of the running encounter or to its definition
// (FR-KIT-104), and every button sends an existing intent (FR-KIT-105, -106): bound → combat's
// `cbt.attack` / `cbt.rollDamage` / `cbt.rollAbility` (as the Initiative row's Attack ▸ and
// Check ▸ / Save ▸); definition → plain `dice.roll`s as the creature. No new intent; 0 B.
import { d20Expression } from "@shared/combat-tracker/rules";
import { CBT_INTENTS, COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import { parseExpression, toNotation } from "@shared/dice-roll-log/grammar";
import type { DiceRollIntent, ManualEntry, StagedPart } from "@shared/dice-roll-log/schemas";
import { ABILITY_NAMES, type Ability, type Attack } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { startedIn } from "@ui/features/combat-tracker/store";
import { manualPartsOf, type RollRequest } from "@ui/features/dice-roll-log/roll-control";
import {
  ATTACK_ACTIONS,
  type AttackAction,
  attackIntent,
  attackRolls,
} from "../../combat-tracker/attack-choices";

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

/** FR-KIT-105 (#385): the two attack buttons (kit order Attack, Damage); Attack + damage is gone. */
export const ATTACK_BUTTONS = ATTACK_ACTIONS.map((a) => ({
  action: a.value,
  label: a.label,
  testId: a.value === "toHit" ? "ent-statblock-roll-attack" : "ent-statblock-roll-damage",
}));

/** The row's own parts of an action (an Alt+click, nothing staged): its dice and types. */
export function rowStagedParts(attack: Attack, action: AttackAction): StagedPart[] {
  const rolls = attackRolls(attack, action);
  return rolls.expressions.map((expression, i) => {
    const type = rolls.partTypes?.[i];
    return type ? { expression, type } : { expression };
  });
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
): Send {
  const manual = r.manual?.[0];
  return {
    name: "dice.roll",
    payload: {
      expression,
      mode: r.mode,
      category,
      label,
      actor: { entityId: as.definitionId },
      ...(manual ? { manual } : {}),
      public: false,
    },
  };
}

/**
 * FR-KIT-105 (#385): a definition's Attack / Damage as the tray rolls a free one (DICEX
 * `freeRollIntent`, not imported: it would pull the tray into the DM's first chunk): one
 * `dice.roll {purpose}` labelled "<name> — <attack> attack / damage", damage as its typed `parts`;
 * `dice.roll` takes physical dice for one expression only (#388), so physical damage is the
 * parts' dice as one expression with one entry. The staged parts, else the row's own (Alt+click).
 * Always `public: false` (as `plainRoll`).
 */
function plainAttackRoll(
  as: Extract<RollAs, { definitionId: string }>,
  attack: Attack,
  action: AttackAction,
  r: RollRequest,
): Send {
  const purpose = action === "damage" ? "damage" : "attack";
  const label = `${as.name} — ${attack.name} ${purpose}`;
  const parts = r.parts ?? rowStagedParts(attack, action);
  const head = { purpose, category: purpose, label, actor: { entityId: as.definitionId } };
  if (purpose === "attack") {
    const manual = r.manual?.[0];
    const expression = parts[0]?.expression ?? "";
    return {
      name: "dice.roll",
      payload: { expression, mode: r.mode, ...head, ...(manual ? { manual } : {}), public: false },
    };
  }
  const manual = r.manual?.length ? r.manual : null;
  return {
    name: "dice.roll",
    payload: {
      ...(manual
        ? { expression: joinedExpression(parts), manual: mergedManual(manual) }
        : { parts }),
      mode: "normal",
      ...head,
      public: false,
    },
  };
}

/** The parts' terms as one expression. */
const joinedExpression = (parts: readonly StagedPart[]): string =>
  toNotation(
    parts.flatMap((p) => {
      const t = parseExpression(p.expression);
      return t.ok ? t.value : [];
    }),
  );

/** Physical entries of several parts as one entry (their dice in notation order). */
function mergedManual(entries: readonly ManualEntry[]): ManualEntry {
  const diceTotal = entries.reduce((n, e) => n + e.diceTotal, 0);
  const dice = entries.every((e) => e.dice) ? entries.flatMap((e) => e.dice ?? []) : null;
  return dice ? { diceTotal, dice } : { diceTotal };
}

/**
 * FR-KIT-105: what one attack button sends, from the roll control's request (a click stages the
 * tray, whose Roll hands back the staged `parts`; Alt+click rolls the row's at once, #385). Bound:
 * as the Initiative row's Attack ▸ (FR-CBT-74, -169, `attackIntent`). Definition:
 * `plainAttackRoll` (a labelled line, no card).
 */
export function attackSend(
  as: RollAs,
  attack: Attack,
  attackId: string | undefined,
  action: AttackAction,
  r: RollRequest,
): Send {
  if (as.combatantId === undefined) return plainAttackRoll(as, attack, action, r);
  return attackIntent(as.combatantId, attackId, action, r);
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
