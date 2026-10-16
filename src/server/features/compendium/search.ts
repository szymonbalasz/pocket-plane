// FR-CMP-10 / -11 search (OQ-CMP-09 pick: SQL narrowing + name ranking, no FTS). Ranking: name
// prefix, word start, substring, then (q ≥ 3 chars) body text; ties by name key, then id. The
// cursor is an opaque keyset (rank, name key, id), validated on the way in.
import {
  type EntrySummary,
  HOMEBREW_LABEL,
  SEARCH_PAGE,
  type SearchQuery,
  TEXT_MATCH_MIN,
} from "@shared/compendium/rest";
import { CR_VALUES } from "@shared/entities/schemas";
import { and, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { invalid } from "../../commands/errors";
import type { Db } from "../../db/client";
import { compendiumEntry, compendiumSource } from "../../db/schema";
import { type EntryViewer, entryVisibleTo } from "./visibility";

/** 0 name prefix, 1 word start, 2 substring, 3 text match. */
export type Rank = 0 | 1 | 2 | 3;

/** Lower-case NFC, trimmed (as `nameKey` / `searchText` are stored). */
export const normalizeQ = (q: string | undefined) =>
  (q ?? "").trim().normalize("NFC").toLowerCase();

const isWordChar = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/**
 * FR-CMP-10 rank of one entry for a normalized `q`; null = no match. Empty `q` → 0 (by name).
 * `textHit`: the entry's `searchText` contains `q` (only counts for q ≥ 3 chars).
 */
export function rankOf(nameKey: string, q: string, textHit: boolean): Rank | null {
  if (q === "") return 0;
  const first = nameKey.indexOf(q);
  if (first === 0) return 0;
  if (first > 0) {
    for (let at = first; at >= 0; at = nameKey.indexOf(q, at + 1)) {
      if (!isWordChar(nameKey.charAt(at - 1))) return 1;
    }
    return 2;
  }
  return q.length >= TEXT_MATCH_MIN && textHit ? 3 : null;
}

// ---------- cursor ----------

const CursorKey = z.tuple([
  z.number().int().min(0).max(3),
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

function compareKeys(a: CursorKey, b: CursorKey): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
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

/** Imported source key → its name; homebrew → "Homebrew". */
function sourceLabels(db: Db): Map<string, string> {
  return new Map(
    db
      .select({ key: compendiumSource.key, name: compendiumSource.name })
      .from(compendiumSource)
      .all()
      .map((s) => [s.key, s.name]),
  );
}

export function searchEntries(db: Db, v: EntryViewer, query: SearchQuery): SearchPage {
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const q = normalizeQ(query.q);
  // A player never sees monsters (FR-CMP-14): an empty page without a read.
  if (v.role === "player" && query.kind === "monster") return { results: [], nextCursor: null };
  const where: (SQL | undefined)[] = [
    or(isNull(compendiumEntry.campaignId), eq(compendiumEntry.campaignId, v.campaignId)),
  ];
  if (query.kind !== undefined) where.push(eq(compendiumEntry.kind, query.kind));
  if (q !== "") {
    where.push(
      q.length >= TEXT_MATCH_MIN
        ? sql`(instr(${compendiumEntry.nameKey}, ${q}) > 0 or instr(${compendiumEntry.searchText}, ${q}) > 0)`
        : sql`instr(${compendiumEntry.nameKey}, ${q}) > 0`,
    );
  }
  const rows = db
    .select({
      id: compendiumEntry.id,
      campaignId: compendiumEntry.campaignId,
      kind: compendiumEntry.kind,
      name: compendiumEntry.name,
      nameKey: compendiumEntry.nameKey,
      line: compendiumEntry.line,
      facets: compendiumEntry.facets,
      source: compendiumEntry.source,
      definitionId: compendiumEntry.definitionId,
      shared: compendiumEntry.shared,
      // Only needed for the text tier; the SQL above already matched it.
      textHit:
        q.length >= TEXT_MATCH_MIN
          ? sql<number>`instr(${compendiumEntry.searchText}, ${q}) > 0`
          : sql<number>`0`,
    })
    .from(compendiumEntry)
    .where(and(...where))
    .all();

  const ranked: { key: CursorKey; row: (typeof rows)[number] }[] = [];
  for (const r of rows) {
    if (!entryVisibleTo(r, v) || !matchesFilters(r.facets, query)) continue;
    const rank = rankOf(r.nameKey, q, Boolean(r.textHit));
    if (rank === null) continue;
    const key: CursorKey = [rank, r.nameKey, r.id];
    if (after && compareKeys(key, after) <= 0) continue;
    ranked.push({ key, row: r });
  }
  ranked.sort((a, b) => compareKeys(a.key, b.key));
  const page = ranked.slice(0, SEARCH_PAGE);
  const labels = sourceLabels(db);
  const results = page.map(({ row: r }): EntrySummary => {
    const s: EntrySummary = {
      id: r.id,
      kind: r.kind,
      name: r.name,
      sourceLabel: r.source === null ? HOMEBREW_LABEL : (labels.get(r.source) ?? r.source),
      line: r.line,
    };
    if (r.kind === "monster" && r.definitionId !== null) s.definitionId = r.definitionId;
    return s;
  });
  const last = page.at(-1);
  return {
    results,
    nextCursor: ranked.length > SEARCH_PAGE && last ? encodeCursor(last.key) : null,
  };
}
