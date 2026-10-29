// Companion card rolls (FR-CHARX-64, -131, OQ-CHARX-36): the two buttons of a card row and the
// intent each sends. In a fight: combat's intents as the companion with the card row's id
// (FR-CBT-114): Attack → `cbt.attack {rolls: "toHit"}`, Damage → `cbt.rollDamage`; a Damage after
// a natural 20 on the row's pending to-hit card is critical (FR-CBT-74). Out of a fight (pets
// only): `char.roll` with the pet as the creature (FR-CHARX-69). Both carry the tray's staged
// `parts` (#385). Never `public` (players can't; the DM's companion lines are DM-only anyway).
import { attackRollSpecs, type CharacterRollSpec } from "@shared/character-sheet/logic";
import {
  type CompanionRollKind,
  type PetRollKind,
  rowPartTypes,
} from "@shared/character-sheet/rolls";
import { CHAR_ROLL } from "@shared/character-sheet/schemas";
import { critExpression } from "@shared/combat-tracker/rules";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import type { CompanionCardAttack } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { manualFields, partsOf, pendingToHitCard } from "../../combat-tracker/roll-route";
import { charRollPayload, type RollRouteInput } from "../routing";

/** What a roll goes out as: the companion combatant in a fight, else the pet. */
export type CardRollTarget = { combatantId: string } | { petId: string };

/** FR-CHARX-64: a card row's roll specs as the server builds them (bonus folded in). */
export function cardRowSpecs(row: CompanionCardAttack, kind: PetRollKind): CharacterRollSpec[] {
  const specs = attackRollSpecs({
    name: row.name,
    toHit: row.toHit,
    damage: row.damage,
    damageType: row.damageType ?? null,
    bonus: row.bonus ?? 0,
    extraDamage: row.extraDamage ?? [],
  });
  if (kind === "toHit") return specs.slice(0, 1);
  if (kind === "damage") return specs.slice(1);
  return specs;
}

/** FR-CHARX-131 (FR-DICEX-101 a): a Damage button's type per part (the tray's die groups). */
export const cardRowPartTypes = (row: CompanionCardAttack) =>
  rowPartTypes(cardRowSpecs(row, "damage"), row.damageType);

/** The intent one button sends (name + payload) from the roll control's input. */
export function cardRollIntent(
  target: CardRollTarget,
  rowId: string,
  kind: CompanionRollKind,
  input: RollRouteInput,
): { name: string; payload: Record<string, unknown> } {
  if ("petId" in target) {
    const { public: _p, ...rest } = input;
    return {
      name: CHAR_ROLL,
      payload: { ...charRollPayload(target.petId, kind, rest, { attackId: rowId }) },
    };
  }
  const attackerId = target.combatantId;
  if (kind === "damage") {
    return {
      name: CBT_INTENTS.rollDamage,
      payload: { attackerId, attackId: rowId, ...manualFields(input, 1), ...partsOf(input) },
    };
  }
  return {
    name: CBT_INTENTS.attack,
    payload: {
      attackerId,
      attackId: rowId,
      mode: input.mode,
      rolls: "toHit",
      ...(input.manual ? { manual: input.manual } : {}),
      ...(input.manualParts ? { manualParts: input.manualParts } : {}),
      ...partsOf(input),
    },
  };
}

/**
 * FR-CBT-74 / -83 in a fight: the roll control's crit options of a row's Damage after a natural
 * 20 on its pending to-hit card (`crit`, the crit dice for the physical form).
 */
export function cardCritOptions(
  target: CardRollTarget,
  row: CompanionCardAttack,
  kind: CompanionRollKind,
  notes: readonly NotificationRecord[],
): { critExpressions?: readonly string[]; crit?: boolean } {
  if (!("combatantId" in target) || kind === "toHit") return {};
  const card = pendingToHitCard(notes, target.combatantId, { attackId: row.id });
  if (card?.toHit?.natural !== 20) return {};
  const critExpressions = cardRowSpecs(row, "damage").map((s) => critExpression(s.expression));
  return { critExpressions, crit: true };
}
