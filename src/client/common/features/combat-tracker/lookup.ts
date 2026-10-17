// Creature lookup (FR-CBT-63): the builder's and the Add dialog's autocomplete. Pure; the part is
// `CreatureLookup` in `./parts`. Matches with the compendium's shared matcher (FR-CMP-37).
import { type NameTier, nameTier, queryWords } from "@shared/compendium/match";

/** What a suggestion row shows: name, CR, XP, source Badge (FR-CBT-63). */
export interface LookupRow {
  id: string;
  name: string;
  cr: string | null;
  xp: number | null;
  badge: string;
}

/** FR-CBT-63: up to 8 suggestions. */
export const LOOKUP_MAX = 8;

/**
 * FR-CBT-63 (S4, FR-CMP-37): from one typed character; every typed word must match the name
 * (folded: case, accents, apostrophes), ranked by the shared `nameTier` (0 exact, 1 name starts
 * with the query, 2 every word starts a name word, 3 every word inside the name); ties keep
 * `rows`' order (FR-ENT-18, or the lookup merge's). Empty input → no list.
 */
export function lookupMatches<R extends { name: string }>(
  rows: readonly R[],
  query: string,
  max = LOOKUP_MAX,
): R[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  return rows
    .map((r, i) => ({ r, i, k: nameTier(r.name, words) }))
    .filter((x): x is { r: R; i: number; k: NameTier } => x.k !== null)
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .slice(0, max)
    .map((x) => x.r);
}

/** "No creature matches ‘…’" (FR-CBT-63). */
export const noMatchText = (query: string) => `No creature matches ‘${query.trim()}’`;
