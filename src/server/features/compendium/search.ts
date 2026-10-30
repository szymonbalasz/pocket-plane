// FR-CMP-10 / -11 / -32–36 / -38 search over the in-memory index (FR-CMP-34). Every query word
// must match the name or the text (shared matcher, FR-CMP-37); tiers 0–5, ties by source rank,
// shorter folded name, folded name, id. Visibility (FR-CMP-14) and filters narrow first, then
// duplicate names collapse into one group row (FR-CMP-35), then the page. The cursor is an
// opaque keyset of the row's tuple (a group: its best member's), validated on the way in.

import {
  type EntrySummary,
  HOMEBREW_LABEL,
  SEARCH_PAGE,
  type SearchQuery,
} from "@shared/compendium/rest";
import { LINE_MAX } from "@shared/compendium/schemas";
import { CR_VALUES } from "@shared/entities/schemas";
import {
  compileQuery,
  NO_TEXT,
  queryTier,
  queryWords,
  type SearchTier,
} from "@shared/search/match";
import { textMasks } from "@shared/search/text-index";
import { z } from "zod";
import { invalid } from "../../commands/errors";
import type { Db } from "../../db/client";
import {
  cmpStr,
  compareByName,
  compareRanked,
  type IndexRow,
  keyOf,
  type SearchIndex,
  searchIndex,
} from "./search-index";
import { type BookAbbrOf, bookAbbrOf } from "./sources/five-etools";
import { type EntryViewer, entryVisibleTo } from "./visibility";

// ---------- cursor ----------

/** FR-CMP-33 keyset: `[tier, sourceRank, folded name length, folded name, id]`. */
const CursorKey = z.tuple([
  z.number().int().min(0).max(5),
  z.number().int().min(0).max(3),
  z.number().int().min(0).max(200),
  z.string().max(200),
  z.string().min(1).max(64),
]);
type CursorKey = z.infer<typeof CursorKey>;

export function encodeCursor(k: CursorKey): string {
  return Buffer.from(JSON.stringify(k), "utf8").toString("base64url");
}

export function decodeCursor(s: string): CursorKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    parsed = null;
  }
  const r = CursorKey.safeParse(parsed);
  if (!r.success) throw invalid("Invalid input", [{ path: ["cursor"], message: "Bad cursor" }]);
  return r.data;
}

// ---------- filters (FR-CMP-11) ----------

const crIndex = (cr: unknown) => (CR_VALUES as readonly unknown[]).indexOf(cr);
const same = (a: unknown, b: string) =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/** The query's facet filters (already checked against the kind by `SearchQuery`). */
export function matchesFilters(facets: unknown, q: SearchQuery): boolean {
  const f = (facets ?? {}) as Record<string, unknown>;
  if (q.crMin !== undefined && crIndex(f.cr) < crIndex(q.crMin)) return false;
  if (q.crMax !== undefined && crIndex(f.cr) > crIndex(q.crMax)) return false;
  if (q.type !== undefined && !same(f.type, q.type)) return false;
  if (q.level !== undefined && f.level !== q.level) return false;
  if (q.school !== undefined && f.school !== q.school) return false;
  if (q.className !== undefined) {
    const ok =
      q.kind === "spell"
        ? Array.isArray(f.classes) && f.classes.includes(q.className)
        : f.className === q.className;
    if (!ok) return false;
  }
  if (q.category !== undefined && f.category !== q.category) return false;
  if (q.rarity !== undefined && !same(f.rarity, q.rarity)) return false;
  if (q.subclass !== undefined && !same(f.subclass, q.subclass)) return false;
  if (q.chapter !== undefined && !same(f.chapter, q.chapter)) return false;
  if (q.section !== undefined && !same(f.section, q.section)) return false;
  return true;
}

// ---------- search ----------

export interface SearchPage {
  results: EntrySummary[];
  nextCursor: string | null;
}

/** A matching row with its tier and its place in the page order (`compareRanked` / `compareByName`). */
export interface Hit {
  row: IndexRow;
  tier: SearchTier;
  order: number;
}

/**
 * FR-CMP-33 tier of index rows for `words`, one query's text lookups prepared once; empty `words`
 * → 0 (the default list). `namesOnly`: tiers 0–3 only. Entry-less definitions have no text.
 */
export function rowMatcher(
  idx: SearchIndex,
  words: readonly string[],
): (row: IndexRow, namesOnly?: boolean) => SearchTier | null {
  if (words.length === 0) return () => 0;
  const q = compileQuery(words);
  const masks = textMasks(idx.text, q, idx.rows.length);
  let pos = 0;
  const inText = (word: number) => masks[word]?.[pos] === 1;
  return (row, namesOnly = false) => {
    pos = row.pos;
    return queryTier(row.folded, q, namesOnly ? NO_TEXT : inText);
  };
}

export function rowTier(
  idx: SearchIndex,
  row: IndexRow,
  words: readonly string[],
): SearchTier | null {
  return rowMatcher(idx, words)(row);
}

/** Visible rows matching kind, filters and words (FR-CMP-14 / -11 / -33), unsorted. */
export function matchingRows(
  idx: SearchIndex,
  v: EntryViewer,
  query: SearchQuery,
  words: readonly string[],
): Hit[] {
  const hits: Hit[] = [];
  // FR-CMP-62 (amends FR-CMP-36): the All tab's empty list skips rule cards; a query finds them,
  // on All by name only (tiers 0–3), so a monster or item word ("goblin") never pulls in the rules
  // text that mentions it; `kind=rule` (the Rules window) matches their text too.
  const skipRules = query.kind === undefined && words.length === 0;
  const ruleNamesOnly = query.kind === undefined;
  const tierOf = rowMatcher(idx, words);
  const byName = words.length === 0;
  const tierStep = idx.rows.length;
  for (const row of idx.rows) {
    // FR-CMPX-14: a replaced entry is found only by asking for its definition (a token's entry).
    if (row.hidden && (!query.definitionId || row.definitionId !== query.definitionId)) continue;
    if (query.kind !== undefined && row.kind !== query.kind) continue;
    if (skipRules && row.kind === "rule") continue;
    // Entry-less definitions: DM only (they are global monsters, so `entryVisibleTo` agrees).
    if (row.entryless && v.role !== "dm") continue;
    if (!entryVisibleTo(row, v) || !matchesFilters(row.facets, query)) continue;
    const tier = tierOf(row, ruleNamesOnly && row.kind === "rule");
    if (tier === null) continue;
    hits.push({ row, tier, order: byName ? row.nameOrder : tier * tierStep + row.rankedOrder });
  }
  return hits;
}

function summaryOf(idx: SearchIndex, row: IndexRow, abbrOf: BookAbbrOf): EntrySummary {
  const sourceLabel =
    row.source === null ? HOMEBREW_LABEL : (idx.labels.get(row.source) ?? row.source);
  const s: EntrySummary = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    sourceLabel,
    line: row.line,
  };
  const abbr = row.source === null ? undefined : abbrOf(row.source, sourceLabel);
  if (abbr !== undefined) s.sourceAbbr = abbr;
  if (row.definitionId !== null) s.definitionId = row.definitionId;
  return s;
}

/** FR-CMP-35 group line: "‹count› entries" (+ " · ‹distinct classes›" for features), ≤ 80. */
export function groupLine(members: readonly IndexRow[]): string {
  const head = `${members.length} entries`;
  const classes = [
    ...new Set(
      members.flatMap((m) => {
        const c = (m.facets as { className?: unknown } | null)?.className;
        return m.kind === "feature" && typeof c === "string" ? [c] : [];
      }),
    ),
  ].sort();
  if (classes.length === 0) return head;
  const full = `${head} · ${classes.join(", ")}`;
  if (full.length <= LINE_MAX) return full;
  let line = `${head} · ${classes[0]}`;
  for (const c of classes.slice(1)) {
    if (`${line}, ${c}…`.length > LINE_MAX) break;
    line = `${line}, ${c}`;
  }
  return `${line}…`;
}

/**
 * The first `n` of `items` by a total order, the rest unsorted: a common word matches nearly every
 * row, and sorting 7,000 hits takes ≈ 2 ms of FR-CMPX-22's 5.
 */
function firstInOrder<T>(items: readonly T[], n: number, compare: (a: T, b: T) => number): T[] {
  const out: T[] = [];
  for (const x of items) {
    if (out.length === n && compare(x, out[n - 1] as T) >= 0) continue;
    let lo = 0;
    let hi = out.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(x, out[mid] as T) < 0) hi = mid;
      else lo = mid + 1;
    }
    out.splice(lo, 0, x);
    if (out.length > n) out.pop();
  }
  return out;
}

/** `pageSize`: tests only (FR-CMP-35 paging across a group); the route always pages by 50. */
export function searchEntries(
  db: Db,
  v: EntryViewer,
  query: SearchQuery,
  pageSize = SEARCH_PAGE,
  abbrOf: BookAbbrOf = bookAbbrOf(null),
): SearchPage {
  if (query.sameAs !== undefined) return sameAsPage(db, v, query.sameAs, query.q, abbrOf);
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  // A player never sees monsters (FR-CMP-14): an empty page without a read.
  if (v.role === "player" && query.kind === "monster") return { results: [], nextCursor: null };
  const words = queryWords(query.q ?? "");
  const compare = words.length === 0 ? compareByName : compareRanked;
  const idx = searchIndex(db);
  const hits = matchingRows(idx, v, query, words);

  // FR-CMP-35: matching visible members per group; ≥ 2 collapse into the best member's row.
  const counts = new Int32Array(idx.groupCount);
  const bestOf = new Int32Array(idx.groupCount);
  hits.forEach((h, i) => {
    const g = h.row.groupId;
    if (g < 0) return;
    if (counts[g] === 0 || h.order < (hits[bestOf[g] as number] as Hit).order) bestOf[g] = i;
    counts[g] = (counts[g] as number) + 1;
  });
  const items = hits.filter((h, i) => h.row.groupId < 0 || bestOf[h.row.groupId] === i);
  const rest = after ? items.filter((h) => compare(keyOf(h.row, h.tier), after) > 0) : items;
  const top = firstInOrder(rest, pageSize + 1, (a, b) => a.order - b.order);
  const page = top.slice(0, pageSize);
  const last = page.at(-1);
  const collapsed = (h: Hit) => h.row.groupId >= 0 && (counts[h.row.groupId] as number) > 1;
  const members = new Map(page.filter(collapsed).map((h) => [h.row.groupId, [] as IndexRow[]]));
  if (members.size > 0) for (const h of hits) members.get(h.row.groupId)?.push(h.row);
  return {
    results: page.map((h) => {
      const s = summaryOf(idx, h.row, abbrOf);
      const group = members.get(h.row.groupId);
      if (group === undefined) return s;
      return { ...s, line: groupLine(group), group: { count: group.length } };
    }),
    nextCursor: top.length > pageSize && last ? encodeCursor(keyOf(last.row, last.tier)) : null,
  };
}

/**
 * FR-CMP-35 `sameAs`: the visible members of `id`'s group that match `q` (empty: all), by line,
 * then id; ≤ 50. Unknown, not visible or entry-less id → an empty page (no existence oracle).
 */
function sameAsPage(
  db: Db,
  v: EntryViewer,
  id: string,
  q: string | undefined,
  abbrOf: BookAbbrOf,
): SearchPage {
  const idx = searchIndex(db);
  const row = idx.byId.get(id);
  if (!row || row.entryless || row.hidden || !entryVisibleTo(row, v)) {
    return { results: [], nextCursor: null };
  }
  const words = queryWords(q ?? "");
  const tierOf = rowMatcher(idx, words);
  const members = (idx.groups.get(row.groupKey) ?? []).filter(
    (m) => entryVisibleTo(m, v) && tierOf(m) !== null,
  );
  members.sort((a, b) => cmpStr(a.line, b.line) || cmpStr(a.id, b.id));
  return {
    results: members.slice(0, SEARCH_PAGE).map((m) => summaryOf(idx, m, abbrOf)),
    nextCursor: null,
  };
}
