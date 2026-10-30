// Compendium's own ranking constants (FR-CMP-38). The generic matcher (fold, words, tiers) is
// `@shared/search/match` (FR-CMP-54). Pure, no dependency.

/** Sources shipped in the repo (FR-CMP-06); the server's `cmp.import` takes these keys only. */
export const BUNDLED_SOURCE_KEYS = ["srd-5.1"] as const;
/** Source of fixture-only imported definitions (disposable data, AGENTS §9.3). */
export const FIXTURE_SOURCE = "fixture";

/** FR-CMPX-02: a 5etools book's source key is `5et-<abbr lower>`. */
export const BOOK_SOURCE_PREFIX = "5et-";

/** FR-CMPX-16: a book source's abbreviation (`5et-mm` → `MM`); null for any other source. */
export function bookAbbr(source: string | null): string | null {
  return source?.startsWith(BOOK_SOURCE_PREFIX)
    ? source.slice(BOOK_SOURCE_PREFIX.length).toUpperCase()
    : null;
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
