// Companion rolls (sprint 6, #252): which `char.roll` kinds a pet's owner may send out of a fight
// (FR-CHARX-69, OQ-CHARX-35) and the companion card's three attack buttons (FR-CHARX-64, §6.1).
import type { SheetRollKind } from "./schemas";

/** FR-CHARX-69: a pet's owner rolls only its attacks: to-hit, damage, attack + damage. */
export const PET_ROLL_KINDS = ["toHit", "damage", "attack"] as const satisfies SheetRollKind[];
export type PetRollKind = (typeof PET_ROLL_KINDS)[number];

export const isPetRollKind = (k: SheetRollKind): k is PetRollKind =>
  (PET_ROLL_KINDS as readonly string[]).includes(k);

/** FR-CHARX-69: the reason a pet owner's `char.roll` kind is refused (`invalid`), or null. */
export const petRollKindError = (k: SheetRollKind): string | null =>
  isPetRollKind(k) ? null : "A pet's owner rolls only its attacks";

/**
 * FR-CHARX-64 (§6.1 labels, `charx-companion-roll` `data-value`): the card row's buttons in
 * order. In a fight they map to combat's intents, outside to `char.roll` with the same kind.
 */
export const COMPANION_ROLL_BUTTONS: readonly { kind: PetRollKind; label: string }[] = [
  { kind: "toHit", label: "Attack" },
  { kind: "damage", label: "Damage" },
  { kind: "attack", label: "Attack + damage" },
];
