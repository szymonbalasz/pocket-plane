// DM Initiative row attack picker (OQ-CHARX-12, FR-CHARX-24): which of a definition's attacks
// `cbt.attack` can name. Pure.
import type { Attack } from "@shared/entities/schemas";

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
