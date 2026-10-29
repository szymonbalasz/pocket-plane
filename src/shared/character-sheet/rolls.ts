// Companion rolls (sprint 6, #252): which `char.roll` kinds a pet's owner may send out of a fight
// (FR-CHARX-69, OQ-CHARX-35) and the companion card's attack buttons (FR-CHARX-64, §6.1).
// Sprint 15 (#385, FR-CHARX-127): a row's Attack / Damage control carries a damage type per
// expression (its purpose: `stagedPurposeOf`), so a click stages the Dice tray pre-filled.
import type { PartDamageType } from "@shared/effect-modifiers/schemas";
import { type CharacterRollSpec, partTypeOf } from "./logic";
import type { SheetRollKind } from "./schemas";

/**
 * FR-CHARX-69: a pet's owner rolls only its attacks: to-hit, damage and (FR-CHARX-129: still
 * accepted, no client sends it) attack + damage.
 */
export const PET_ROLL_KINDS = ["toHit", "damage", "attack"] as const satisfies SheetRollKind[];
export type PetRollKind = (typeof PET_ROLL_KINDS)[number];

export const isPetRollKind = (k: SheetRollKind): k is PetRollKind =>
  (PET_ROLL_KINDS as readonly string[]).includes(k);

/** FR-CHARX-69: the reason a pet owner's `char.roll` kind is refused (`invalid`), or null. */
export const petRollKindError = (k: SheetRollKind): string | null =>
  isPetRollKind(k) ? null : "A pet's owner rolls only its attacks";

/** FR-CHARX-131: the kinds the companion card sends (Attack + damage is gone, #385). */
export type CompanionRollKind = Extract<PetRollKind, "toHit" | "damage">;

/**
 * FR-CHARX-64, -131 (§6.1 labels, `charx-companion-roll` `data-value`): the card row's two
 * buttons in order. In a fight they map to combat's intents, outside to `char.roll` with the same
 * kind.
 */
export const COMPANION_ROLL_BUTTONS: readonly { kind: CompanionRollKind; label: string }[] = [
  { kind: "toHit", label: "Attack" },
  { kind: "damage", label: "Damage" },
];

/**
 * FR-CHARX-127 (FR-DICEX-101 a): each spec's damage type, parallel to the expressions: null for
 * the to-hit and an untyped part (healing); a single-part row's specs carry no `part`, so its type
 * is the row's (`rowType`, a free-text type that isn't a part type → null).
 */
export function rowPartTypes(
  specs: readonly CharacterRollSpec[],
  rowType: string | null | undefined,
): (PartDamageType | null)[] {
  return specs.map((s) =>
    s.d20 || s.category === "healing" ? null : s.part ? s.part.type : partTypeOf(rowType),
  );
}
