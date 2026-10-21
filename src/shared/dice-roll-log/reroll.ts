// Rerolls (sprint 7, FR-DICE-62–70): which roll of an entry a reroll takes, the d20 term it
// re-rolls, and the stats counting contract (FR-DICE-67). Pure; server check and client action
// share them. Callers add their own rules (gems: actor, window, card state, FR-GEM-18).
import { type DiceTerm, parseExpression } from "./grammar";
import { ROLL_KIND } from "./roll-kind";
import { GAME_LOG_WINDOW, type RollCategory, RollEntryPayload } from "./schemas";

/**
 * FR-DICE-62: the d20 term a reroll re-rolls: `1d20`, `2d20kh1` or `2d20kl1` (adv / dis), added.
 * Index into the expression's dice terms, or -1.
 */
export function d20TermIndex(terms: readonly DiceTerm[]): number {
  return terms.findIndex(
    (t) =>
      t.faces === 20 &&
      t.sign === 1 &&
      ((t.count === 1 && t.keep === null) || (t.count === 2 && t.keep?.n === 1)),
  );
}

/** Does this roll expression have a d20 term a reroll can take? */
export function hasD20Term(expression: string): boolean {
  const parsed = parseExpression(expression);
  if (!parsed.ok) return false;
  return d20TermIndex(parsed.value.filter((t): t is DiceTerm => t.kind === "dice")) >= 0;
}

/** The entry fields `rerollableRoll` reads. */
export interface RerollableEntry {
  kind: string;
  category: RollCategory;
  undone: boolean;
  supersededBy: string | null;
  payload: unknown;
}

/**
 * FR-DICE-70: the first roll of a `roll` entry whose expression has a d20 term; null when the
 * entry is not a `roll`, is `initiative`, undone or superseded, or has no such roll.
 */
export function rerollableRoll(entry: RerollableEntry): string | null {
  if (entry.kind !== ROLL_KIND || entry.category === "initiative") return null;
  if (entry.undone || entry.supersededBy !== null) return null;
  const items = RollEntryPayload.safeParse(entry.payload);
  if (!items.success) return null;
  return items.data.find((i) => hasD20Term(i.expression))?.rollId ?? null;
}

/**
 * FR-GEM-18 (OQ-GEM-05 A): is entry `n` in the newest-100 window, given the campaign's newest
 * `n`? Entries are numbered 1, 2, … per campaign and never deleted (FR-DICE-17), so the newer
 * entries are exactly `newest - n`. The server passes the campaign's newest; a client its store's.
 */
export const inRerollWindow = (n: number, newest: number): boolean => newest - n < GAME_LOG_WINDOW;

/** The entry fields the counting contract reads. */
export interface CountedEntry {
  undone: boolean;
  supersededBy: string | null;
  rollIds: readonly string[];
}

/**
 * FR-DICE-67 (stats contract, seams S2): a roll counts iff some entry that is neither undone nor
 * superseded lists it; a reroll is never an extra roll, a superseded roll never counts.
 */
export function countedRollIds(entries: readonly CountedEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (e.undone || e.supersededBy !== null) continue;
    for (const id of e.rollIds) out.add(id);
  }
  return out;
}
