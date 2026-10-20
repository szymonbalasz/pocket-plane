// Image search and the picker's tag filter (ASSET §6.3, FR-ASSET-44, -46, -47). Built only from
// the shared matcher (`@shared/search/match`, FR-CMP-54): every word starts a name word, sits
// inside the name, or (≥ 3 chars) starts a tag word. Client-side over the DM's `asset` records;
// folded names and tag words are memoised per record (records are replaced, never mutated).
import {
  type FoldedName,
  foldName,
  nameTier,
  queryWords,
  searchTier,
  textWordsOf,
} from "@shared/search/match";
import type { AssetRecord } from "./schemas";
import { IMAGE_TAGS, isBuiltInTag, tagKey } from "./tags";

/** FR-ASSET-46: one chip at a time: All, one tag (by `tagKey`), or Untagged. */
export type TagFilter = { kind: "all" } | { kind: "untagged" } | { kind: "tag"; key: string };

export const ALL_IMAGES: TagFilter = { kind: "all" };

interface Prepared {
  name: FoldedName;
  tagWords: readonly string[];
  tagKeys: ReadonlySet<string>;
}

const prepared = new WeakMap<AssetRecord, Prepared>();

function prep(a: AssetRecord): Prepared {
  let p = prepared.get(a);
  if (!p) {
    p = {
      name: foldName(a.name),
      tagWords: textWordsOf(a.tags.join(" ")),
      tagKeys: new Set(a.tags.map(tagKey)),
    };
    prepared.set(a, p);
  }
  return p;
}

export function passesFilter(a: AssetRecord, filter: TagFilter): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "untagged") return a.tags.length === 0;
  return prep(a).tagKeys.has(filter.key);
}

/**
 * FR-ASSET-44 `matchImages`: `assets` in picker order (FR-ASSET-10); the filter narrows first;
 * empty `q` → picker order; else the matches by tier, then picker order.
 */
export function matchImages(
  assets: readonly AssetRecord[],
  q: string,
  filter: TagFilter = ALL_IMAGES,
): AssetRecord[] {
  const narrowed =
    filter.kind === "all" ? [...assets] : assets.filter((a) => passesFilter(a, filter));
  const words = queryWords(q);
  if (words.length === 0) return narrowed;
  const hits: { a: AssetRecord; tier: number; i: number }[] = [];
  narrowed.forEach((a, i) => {
    const p = prep(a);
    const tier = searchTier(p.name, p.tagWords, words);
    if (tier !== null) hits.push({ a, tier, i });
  });
  return hits.sort((x, y) => x.tier - y.tier || x.i - y.i).map((h) => h.a);
}

/** A tag held by ≥ 1 listed image: its spelling (as stored, FR-ASSET-39), key and count. */
export interface TagChip {
  key: string;
  label: string;
  count: number;
  builtIn: boolean;
}

export interface TagChips {
  /** Built-ins in FR-ASSET-40 order, then DM tags A–Z. */
  tags: TagChip[];
  /** Images with no tag (the Untagged chip shows only when > 0). */
  untagged: number;
}

/** FR-ASSET-46: the chip row's tags and counts over the listed images. */
export function tagChips(assets: readonly AssetRecord[]): TagChips {
  const byKey = new Map<string, TagChip>();
  let untagged = 0;
  for (const a of assets) {
    if (a.tags.length === 0) untagged++;
    for (const key of prep(a).tagKeys) {
      const chip = byKey.get(key);
      if (chip) chip.count++;
      else {
        const label = a.tags.find((t) => tagKey(t) === key) ?? key;
        byKey.set(key, { key, label, count: 1, builtIn: isBuiltInTag(label) });
      }
    }
  }
  const builtIns = IMAGE_TAGS.flatMap((t) => byKey.get(tagKey(t)) ?? []);
  const dm = [...byKey.values()]
    .filter((c) => !c.builtIn)
    .sort(
      (x, y) =>
        x.label.localeCompare(y.label, "en", { sensitivity: "base" }) || (x.key < y.key ? -1 : 1),
    );
  return { tags: [...builtIns, ...dm], untagged };
}

/** A chip filter that still has images; a tag whose last image lost it falls back to All. */
export function liveFilter(filter: TagFilter, chips: TagChips): TagFilter {
  if (filter.kind === "tag")
    return chips.tags.some((c) => c.key === filter.key) ? filter : ALL_IMAGES;
  if (filter.kind === "untagged") return chips.untagged > 0 ? filter : ALL_IMAGES;
  return filter;
}

/** Suggestions shown at most (FR-ASSET-47). */
export const TAG_SUGGESTIONS_MAX = 8;

/**
 * FR-ASSET-47 Add tag suggestions: the campaign's tags and the built-ins, minus the image's own,
 * ranked by the shared matcher (name tier, then chip order); empty `q` → chip order.
 */
export function tagSuggestions(chips: TagChips, q: string, held: readonly string[]): string[] {
  const heldKeys = new Set(held.map(tagKey));
  const seen = new Set<string>();
  const all: string[] = [];
  for (const t of [...IMAGE_TAGS, ...chips.tags.map((c) => c.label)]) {
    const k = tagKey(t);
    if (heldKeys.has(k) || seen.has(k)) continue;
    seen.add(k);
    all.push(t);
  }
  const words = queryWords(q);
  if (words.length === 0) return all.slice(0, TAG_SUGGESTIONS_MAX);
  return all
    .map((t, i) => ({ t, i, tier: nameTier(t, words) }))
    .filter((x) => x.tier !== null)
    .sort((x, y) => (x.tier ?? 0) - (y.tier ?? 0) || x.i - y.i)
    .slice(0, TAG_SUGGESTIONS_MAX)
    .map((x) => x.t);
}

/**
 * The spelling a typed tag is stored in (FR-ASSET-39): an existing tag's or built-in's when
 * fold-equal, else as typed.
 */
export function existingSpelling(chips: TagChips, tag: string): string | null {
  const k = tagKey(tag);
  return (
    IMAGE_TAGS.find((t) => tagKey(t) === k) ?? chips.tags.find((c) => c.key === k)?.label ?? null
  );
}

export const imagesText = (n: number) => `${n} image${n === 1 ? "" : "s"}`;

/** FR-ASSET-47 Rename… confirm line: a merge names both tags and the images it changes. */
export function renamePrompt(chips: TagChips, from: TagChip, to: string): string | null {
  const target = existingSpelling(chips, to);
  if (target === null || tagKey(target) === from.key) return null;
  return `Merge ${from.label} into ${target}? ${imagesText(from.count)}`;
}

/** FR-ASSET-47 Delete… confirm line. */
export const deletePrompt = (chip: TagChip) =>
  `Remove ${chip.label} from ${imagesText(chip.count)}?`;
