// Creature lookup (FR-CBT-63): the builder's and the Add dialog's autocomplete. Pure; the part is
// `CreatureLookup` in `./parts`.

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

const WORD_START = /[\s\-–—(/,.'’]/;

/** 0 = name prefix, 1 = a word starts with it, 2 = substring, null = no match. */
function rank(name: string, q: string): 0 | 1 | 2 | null {
  const n = name.toLowerCase();
  const at = n.indexOf(q);
  if (at < 0) return null;
  if (at === 0) return 0;
  for (let i = at; i >= 0; i = n.indexOf(q, i + 1)) {
    if (i > 0 && WORD_START.test(n[i - 1] as string)) return 1;
  }
  return 2;
}

/**
 * FR-CBT-63: from one typed character, case-insensitive; name prefix, then word start, then
 * substring; ties keep `rows`' order (FR-ENT-18). Empty input → no list.
 */
export function lookupMatches<R extends { name: string }>(
  rows: readonly R[],
  query: string,
  max = LOOKUP_MAX,
): R[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return rows
    .map((r, i) => ({ r, i, k: rank(r.name, q) }))
    .filter((x): x is { r: R; i: number; k: 0 | 1 | 2 } => x.k !== null)
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .slice(0, max)
    .map((x) => x.r);
}

/** "No creature matches ‘…’" (FR-CBT-63). */
export const noMatchText = (query: string) => `No creature matches ‘${query.trim()}’`;
