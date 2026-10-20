// Compendium's own ranking constants (FR-CMP-38). The generic matcher (fold, words, tiers) is
// `@shared/search/match` (FR-CMP-54). Pure, no dependency.

/** Sources shipped in the repo (FR-CMP-06); the server's `cmp.import` takes these keys only. */
export const BUNDLED_SOURCE_KEYS = ["srd-5.1"] as const;
/** Source of fixture-only imported definitions (disposable data, AGENTS §9.3). */
export const FIXTURE_SOURCE = "fixture";

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
