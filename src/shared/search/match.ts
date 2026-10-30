// The one search matcher (FR-CMP-32 / -33 / -37 / -54): the server's compendium search index, the
// DM Creatures window filter (FR-ENT-18), the creature lookups (FR-CBT-63) and image search
// (FR-ASSET-44) all match with it, so a multi-word query finds the same names everywhere. Pure,
// no dependency.

/** FR-CMP-32: query words kept after folding and deduplication. */
export const QUERY_WORDS_MAX = 8;
/** FR-CMP-33: a query word shorter than this never matches the text (names only). */
export const TEXT_MATCH_MIN = 3;
/** FR-CMP-32: a word of at least this length ending in `s` also matches without it. */
export const PLURAL_MIN = 4;

/**
 * FR-CMP-32 fold: lower-case, Unicode NFD with combining marks removed, `'` / `’` removed
 * ("Hunter's" → `hunters`), every other run of non-letters / non-digits → one space, trimmed.
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** FR-CMP-32: `fold(q)` split on spaces, duplicates dropped, the first 8 kept. */
export function queryWords(q: string): string[] {
  const f = fold(q);
  return f === "" ? [] : [...new Set(f.split(" "))].slice(0, QUERY_WORDS_MAX);
}

/** A query word and its plural fallback (FR-CMP-32; tiers 2–5 only): `potions` → `potion`. */
export function wordForms(w: string): readonly string[] {
  return w.length >= PLURAL_MIN && w.endsWith("s") ? [w, w.slice(0, -1)] : [w];
}

/** A folded name and its words, prepared once per row (the server index keeps these). */
export interface FoldedName {
  folded: string;
  words: readonly string[];
}

export function foldName(name: string): FoldedName {
  const folded = fold(name);
  return { folded, words: folded === "" ? [] : folded.split(" ") };
}

/** Name tiers (FR-CMP-33): 0 exact, 1 starts with the phrase, 2 every word starts a name word, 3 every word inside the name. */
export type NameTier = 0 | 1 | 2 | 3;
/** Search tiers: the name tiers, 4 name + text, 5 text only. */
export type SearchTier = NameTier | 4 | 5;

type WordHit = "start" | "inside" | null;

/** A query's words with what matching each row needs, prepared once per search. */
export interface CompiledQuery {
  words: readonly string[];
  /** FR-CMP-32 query phrase (tiers 0–1). */
  phrase: string;
  /** Each word's `wordForms`. */
  forms: readonly (readonly string[])[];
}

export function compileQuery(words: readonly string[]): CompiledQuery {
  return { words, phrase: words.join(" "), forms: words.map(wordForms) };
}

function nameHit(n: FoldedName, forms: readonly string[]): WordHit {
  for (const nw of n.words) {
    for (const f of forms) if (nw.startsWith(f)) return "start";
  }
  for (const f of forms) if (n.folded.includes(f)) return "inside";
  return null;
}

/** First index in sorted `words` that is ≥ `w` (binary search). */
export function lowerBound(words: readonly string[], w: string): number {
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((words[mid] as string) < w) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Sorted unique folded words of a text, as `searchTier` reads them. */
export function textWordsOf(text: string): string[] {
  const f = fold(text);
  return f === "" ? [] : [...new Set(f.split(" "))].sort();
}

/** `queryTier`'s `inText` for a name-only match. */
export const NO_TEXT = (_word: number): boolean => false;

/**
 * FR-CMP-33: the tier of a name for a compiled query, or null when a word matches neither name nor
 * text. `inText(i)`: the text has `q.words[i]` (asked only of words the name lacks). No words → null.
 */
export function queryTier(
  name: FoldedName,
  q: CompiledQuery,
  inText: (word: number) => boolean,
): SearchTier | null {
  const n = q.forms.length;
  if (n === 0) return null;
  let inName = 0;
  let allStart = true;
  for (let i = 0; i < n; i++) {
    const hit = nameHit(name, q.forms[i] as readonly string[]);
    if (hit === null) {
      if (!inText(i)) return null;
    } else {
      inName++;
      if (hit === "inside") allStart = false;
    }
  }
  if (inName < n) return inName > 0 ? 4 : 5;
  if (name.folded === q.phrase) return 0;
  if (name.folded.startsWith(q.phrase)) return 1;
  return allStart ? 2 : 3;
}

/**
 * FR-CMP-37 `nameTier`: the tier (0–3) of a name for `words` (`queryWords(q)`), or null when a
 * word isn't in the name. No words → null (an empty query is the caller's default list).
 */
export function nameTier(name: string | FoldedName, words: readonly string[]): NameTier | null {
  if (words.length === 0) return null;
  const n = typeof name === "string" ? foldName(name) : name;
  // Without text the tier is a name tier.
  return queryTier(n, compileQuery(words), NO_TEXT) as NameTier | null;
}

/**
 * FR-CMP-33: an entry matches iff every word matches its name or its text (`textWords`: sorted,
 * unique, folded, see `textWordsOf`). Name tiers 0–3, else 4 (≥ 1 word in the name, the rest
 * only in the text) or 5 (text only). No words → null.
 */
export function searchTier(
  name: FoldedName,
  textWords: readonly string[],
  words: readonly string[],
): SearchTier | null {
  const q = compileQuery(words);
  return queryTier(name, q, (i) => {
    if ((words[i] as string).length < TEXT_MATCH_MIN) return false;
    return (q.forms[i] as readonly string[]).some(
      (f) => textWords[lowerBound(textWords, f)]?.startsWith(f) === true,
    );
  });
}
