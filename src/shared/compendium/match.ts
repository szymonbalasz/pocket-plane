// The one search matcher (FR-CMP-32 / -33 / -37 / -38): the server's search index, the DM
// Creatures window filter (FR-ENT-18) and the creature lookups (FR-CBT-63) all match with it, so
// a multi-word query finds the same names everywhere. Pure, no dependency.

/** FR-CMP-32: query words kept after folding and deduplication. */
export const QUERY_WORDS_MAX = 8;
/** FR-CMP-33: a query word shorter than this never matches the text (names only). */
export const TEXT_MATCH_MIN = 3;
/** FR-CMP-32: a word of at least this length ending in `s` also matches without it. */
export const PLURAL_MIN = 4;

/** Sources shipped in the repo (FR-CMP-06); the server's `cmp.import` takes these keys only. */
export const BUNDLED_SOURCE_KEYS = ["srd-5.1"] as const;
/** Source of fixture-only imported definitions (disposable data, AGENTS §9.3). */
export const FIXTURE_SOURCE = "fixture";

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

function nameHit(n: FoldedName, w: string): WordHit {
  const forms = wordForms(w);
  if (n.words.some((nw) => forms.some((f) => nw.startsWith(f)))) return "start";
  return forms.some((f) => n.folded.includes(f)) ? "inside" : null;
}

/** First index in sorted `words` that is ≥ `w` (binary search). */
function lowerBound(words: readonly string[], w: string): number {
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((words[mid] as string) < w) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A word of the **sorted** `textWords` starts with `w` (or its plural fallback). */
function textHit(textWords: readonly string[], w: string): boolean {
  if (w.length < TEXT_MATCH_MIN) return false;
  return wordForms(w).some((f) => textWords[lowerBound(textWords, f)]?.startsWith(f) === true);
}

/** Sorted unique folded words of a text, as `searchTier` reads them. */
export function textWordsOf(text: string): string[] {
  const f = fold(text);
  return f === "" ? [] : [...new Set(f.split(" "))].sort();
}

function tierOfName(n: FoldedName, words: readonly string[], hits: readonly WordHit[]): NameTier | null {
  const phrase = words.join(" ");
  if (n.folded === phrase) return 0;
  if (n.folded.startsWith(phrase)) return 1;
  if (hits.every((h) => h === "start")) return 2;
  return hits.every((h) => h !== null) ? 3 : null;
}

/**
 * FR-CMP-37 `nameTier`: the tier (0–3) of a name for `words` (`queryWords(q)`), or null when a
 * word isn't in the name. No words → null (an empty query is the caller's default list).
 */
export function nameTier(name: string | FoldedName, words: readonly string[]): NameTier | null {
  if (words.length === 0) return null;
  const n = typeof name === "string" ? foldName(name) : name;
  return tierOfName(n, words, words.map((w) => nameHit(n, w)));
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
  if (words.length === 0) return null;
  const hits = words.map((w) => nameHit(name, w));
  if (hits.every((h) => h !== null)) return tierOfName(name, words, hits);
  if (!words.every((w, i) => hits[i] !== null || textHit(textWords, w))) return null;
  return hits.some((h) => h !== null) ? 4 : 5;
}

export type SourceRank = 0 | 1 | 2 | 3;

/**
 * FR-CMP-38 source rank on equal tiers: 0 the campaign's own (homebrew entries, custom
 * definitions: `source` null), 1 bundled sources, 2 other imported sources, 3 `fixture`.
 */
export function sourceRank(source: string | null): SourceRank {
  if (source === null) return 0;
  if ((BUNDLED_SOURCE_KEYS as readonly string[]).includes(source)) return 1;
  return source === FIXTURE_SOURCE ? 3 : 2;
}
