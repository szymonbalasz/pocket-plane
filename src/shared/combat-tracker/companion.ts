// Companion rules shared by the server and both clients (sprint 6, #252, FR-CBT-105–117): who a
// companion is, its owner state (FR-CBT-108), the card's row ids on the stat block (FR-CBT-114 /
// -117) and the outcome line's player-safe to-hit (FR-CBT-114, ADR-0056). Ranks per turn mode
// live in `rules.ts` (`ranks`, `inTurnCompanionsOf`).
import type { Attack, CompanionCard, TurnMode } from "@shared/entities/schemas";
import type { AttackLogPayload } from "./log-kinds";

/** FR-CBT-105: a companion = owner fields set (pet or summon). */
export const isCompanion = (c: { ownerCharacterId?: string | null }): boolean =>
  (c.ownerCharacterId ?? null) !== null;

/** CBT §8 derived: `summon = ownerPlayerId ≠ null ∧ ¬pet`. */
export const isSummon = (c: { ownerPlayerId?: string | null; pet?: boolean }): boolean =>
  (c.ownerPlayerId ?? null) !== null && c.pet !== true;

/** The default turn mode (FR-CBT-106). */
export const DEFAULT_TURN_MODE: TurnMode = "after-owner";

/**
 * FR-CBT-114 / -117: the stat block's attack rows with the card's stable ids filled in where a
 * row has none (imported definitions): the card row at the same index with the same name. A row
 * with its own id keeps it (the card copied it).
 */
export function withCardIds<S extends { attacks: Attack[] }>(
  statBlock: S,
  card: CompanionCard | null,
): S {
  if (!card || statBlock.attacks.every((a) => a.id !== undefined)) return statBlock;
  return {
    ...statBlock,
    attacks: statBlock.attacks.map((a, i) => {
      const row = card.attacks[i];
      return a.id === undefined && row && row.name === a.name ? { ...a, id: row.id } : a;
    }),
  };
}

/**
 * FR-CBT-114 (review 1, ADR-0056; walkthrough 7): a companion's outcome line keeps the to-hit
 * total only; the d20 face (total − face = the bonus), the "N + M" split and the effect parts go
 * to `dmPayload` (`toHitNatural`, the rolls; the owner has them on its roll line and card), and
 * the entry carries none of the card's roll ids (`companionLineRollIds`). Players read "— DM:
 * hit." / "— DM: miss" (no "(natural 20)", no public ruling): totals only.
 */
export function companionSafeToHit(t: AttackLogPayload["toHit"]): AttackLogPayload["toHit"] {
  if (t === null) return null;
  return { dice: null, constant: 0, total: t.total, natural: null };
}

/** FR-CBT-114 (walkthrough 7): an outcome line's public roll ids; a companion's: none of its card's. */
export const companionLineRollIds = (
  attacker: { ownerCharacterId?: string | null },
  cardRollIds: readonly string[],
  other: readonly string[] = [],
): string[] => (isCompanion(attacker) ? [...other] : [...cardRollIds, ...other]);
