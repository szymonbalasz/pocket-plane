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
import { nameTier, queryWords, type SearchTier, searchTier } from "@shared/search/match";
import { z } from "zod";
import { invalid } from "../../commands/errors";
import type { Db } from "../../db/client";
import { type IndexRow, type SearchIndex, searchIndex } from "./search-index";
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

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** FR-CMP-33 order: tier, source rank, shorter folded name, folded name, id. */
function compareRanked(a: CursorKey, b: CursorKey): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || cmpStr(a[3], b[3]) || cmpStr(a[4], b[4]);
}

/** FR-CMP-36 default list (empty `q`): folded name, then source rank, then id. */
function compareByName(a: CursorKey, b: CursorKey): number {
  return cmpStr(a[3], b[3]) || a[1] - b[1] || cmpStr(a[4], b[4]);
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
  return true;
}

// ---------- search ----------

export interface SearchPage {
  results: EntrySummary[];
  nextCursor: string | null;
}

/** A matching row with its tier and tuple. */
export interface Hit {
  row: IndexRow;
  tier: SearchTier;
  key: CursorKey;
}

/**
 * FR-CMP-33 tier of one index row for `words`; empty `words` → 0 (the default list). Entry-less
 * definitions match on the name only (tiers 0–3).
 */
export function rowTier(row: IndexRow, words: readonly string[]): SearchTier | null {
  if (words.length === 0) return 0;
  return row.entryless ? nameTier(row.folded, words) : searchTier(row.folded, row.textWords, words);
}

const keyOf = (row: IndexRow, tier: SearchTier): CursorKey => [
  tier,
  row.rank,
  Math.min(row.folded.folded.length, 200),
  row.folded.folded.slice(0, 200),
  row.id,
];

/** Visible rows matching kind, filters and words (FR-CMP-14 / -11 / -33), unsorted. */
export function matchingRows(
  idx: SearchIndex,
  v: EntryViewer,
  query: SearchQuery,
  words: readonly string[],
): Hit[] {
  const hits: Hit[] = [];
  for (const row of idx.rows) {
    if (query.kind !== undefined && row.kind !== query.kind) continue;
    // Entry-less definitions: DM only (they are global monsters, so `entryVisibleTo` agrees).
    if (row.entryless && v.role !== "dm") continue;
    if (!entryVisibleTo(row, v) || !matchesFilters(row.facets, query)) continue;
    const tier = rowTier(row, words);
    if (tier !== null) hits.push({ row, tier, key: keyOf(row, tier) });
  }
  return hits;
}

function summaryOf(idx: SearchIndex, row: IndexRow): EntrySummary {
  const s: EntrySummary = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    sourceLabel: row.source === null ? HOMEBREW_LABEL : (idx.labels.get(row.source) ?? row.source),
    line: row.line,
  };
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

/** `pageSize`: tests only (FR-CMP-35 paging across a group); the route always pages by 50. */
export function searchEntries(
  db: Db,
  v: EntryViewer,
  query: SearchQuery,
  pageSize = SEARCH_PAGE,
): SearchPage {
  if (query.sameAs !== undefined) return sameAsPage(db, v, query.sameAs, query.q);
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  // A player never sees monsters (FR-CMP-14): an empty page without a read.
  if (v.role === "player" && query.kind === "monster") return { results: [], nextCursor: null };
  const words = queryWords(query.q ?? "");
  const compare = words.length === 0 ? compareByName : compareRanked;
  const idx = searchIndex(db);
  const hits = matchingRows(idx, v, query, words);

  // FR-CMP-35: matching visible members per group; ≥ 2 collapse into the best member's row.
  const members = new Map<string, Hit[]>();
  for (const h of hits) {
    if (h.row.entryless) continue;
    const g = members.get(h.row.groupKey);
    if (g) g.push(h);
    else members.set(h.row.groupKey, [h]);
  }
  const items: { best: Hit; group: Hit[] | null }[] = [];
  for (const h of hits) {
    const g = h.row.entryless ? undefined : members.get(h.row.groupKey);
    if (!g || g.length === 1) items.push({ best: h, group: null });
    else if (g.every((m) => m === h || compare(h.key, m.key) < 0))
      items.push({ best: h, group: g });
  }
  items.sort((a, b) => compare(a.best.key, b.best.key));
  const rest = after ? items.filter((x) => compare(x.best.key, after) > 0) : items;
  const page = rest.slice(0, pageSize);
  const last = page.at(-1);
  return {
    results: page.map(({ best, group }) => {
      const s = summaryOf(idx, best.row);
      if (group === null) return s;
      return {
        ...s,
        line: groupLine(group.map((m) => m.row)),
        group: { count: group.length },
      };
    }),
    nextCursor: rest.length > pageSize && last ? encodeCursor(last.best.key) : null,
  };
}

/**
 * FR-CMP-35 `sameAs`: the visible members of `id`'s group that match `q` (empty: all), by line,
 * then id; ≤ 50. Unknown, not visible or entry-less id → an empty page (no existence oracle).
 */
function sameAsPage(db: Db, v: EntryViewer, id: string, q: string | undefined): SearchPage {
  const idx = searchIndex(db);
  const row = idx.byId.get(id);
  if (!row || row.entryless || !entryVisibleTo(row, v)) return { results: [], nextCursor: null };
  const words = queryWords(q ?? "");
  const members = (idx.groups.get(row.groupKey) ?? []).filter(
    (m) => entryVisibleTo(m, v) && rowTier(m, words) !== null,
  );
  members.sort((a, b) => cmpStr(a.line, b.line) || cmpStr(a.id, b.id));
  return { results: members.slice(0, SEARCH_PAGE).map((m) => summaryOf(idx, m)), nextCursor: null };
}
