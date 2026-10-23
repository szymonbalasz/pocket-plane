// Rules window reads (FR-CMP-64, -65, -67): the page index and one page's cards, computed per
// request from the curated `RULE_PAGES` and the viewer's visible entries (FR-CMP-14; players:
// shared house rules only). A page key resolves to the best-ranked visible entry with that
// `sourceKey` (FR-CMP-38); a key no entry has is skipped (CMP §11). REST only, never a record
// (FR-CMP-71: 0 B). ETag: an opaque hash of the source version, the campaign's homebrew-rule
// version (count + newest `updatedAt`, review-a ruling 17) and the body itself, so deleting,
// unsharing or editing any house rule changes it even on a fixed clock (no stale 304).

import { createHash } from "node:crypto";
import { BUNDLED_SOURCE_KEYS } from "@shared/compendium/match";
import {
  CONDITIONS_SECTION,
  type RuleCardBody,
  type RulesIndexResponse,
} from "@shared/compendium/rules";
import { HOUSE_PAGE_ID, RULE_PAGES } from "@shared/compendium/rules-pages";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { compendiumEntry, compendiumSource } from "../../db/schema";
import { entryEtag } from "./read";
import { type IndexRow, type SearchIndex, searchIndex } from "./search-index";
import { type EntryViewer, entryVisibleTo } from "./visibility";

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const sectionOf = (row: IndexRow): string => {
  if (row.kind === "condition") return CONDITIONS_SECTION;
  const s = (row.facets as { section?: unknown } | null)?.section;
  return typeof s === "string" ? s : "";
};

const summary = (row: IndexRow) => ({ id: row.id, name: row.name, section: sectionOf(row) });

/** `sourceKey` → the best visible imported row (FR-CMP-38: source rank, then id). */
function bySourceKey(idx: SearchIndex, v: EntryViewer): Map<string, IndexRow> {
  const out = new Map<string, IndexRow>();
  for (const row of idx.rows) {
    if (row.sourceKey === null || (row.kind !== "rule" && row.kind !== "condition")) continue;
    if (!entryVisibleTo(row, v)) continue;
    const prev = out.get(row.sourceKey);
    if (!prev || row.rank < prev.rank || (row.rank === prev.rank && row.id < prev.id)) {
      out.set(row.sourceKey, row);
    }
  }
  return out;
}

/** FR-CMP-67: the campaign's house rules the viewer may read, by name. */
function houseRules(idx: SearchIndex, v: EntryViewer): IndexRow[] {
  return idx.rows
    .filter((r) => r.kind === "rule" && r.source === null && entryVisibleTo(r, v))
    .sort((a, b) => cmpStr(a.folded.folded, b.folded.folded) || cmpStr(a.id, b.id));
}

/** Cards of one page id in order; null = no such page. */
function pageRows(idx: SearchIndex, v: EntryViewer, pageId: string, keys = bySourceKey(idx, v)) {
  if (pageId === HOUSE_PAGE_ID) return houseRules(idx, v);
  const page = RULE_PAGES.find((p) => p.id === pageId);
  if (!page) return null;
  return page.items.flatMap((k) => {
    const row = keys.get(k);
    return row ? [row] : [];
  });
}

/** Review-a ruling 17: the campaign's homebrew-rule version (every row, whoever reads). */
function houseVersion(db: Db, campaignId: string): string {
  const rows = db
    .select({ updatedAt: compendiumEntry.updatedAt })
    .from(compendiumEntry)
    .where(and(eq(compendiumEntry.campaignId, campaignId), eq(compendiumEntry.kind, "rule")))
    .all();
  const newest = rows.reduce((m, r) => (r.updatedAt > m ? r.updatedAt : m), "");
  return `${rows.length}:${newest}`;
}

function bundledSourceRow(db: Db) {
  return db
    .select()
    .from(compendiumSource)
    .where(inArray(compendiumSource.key, [...BUNDLED_SOURCE_KEYS]))
    .get();
}

const digest = (body: unknown) =>
  createHash("sha256").update(JSON.stringify(body)).digest("base64url");

export interface RulesRead<T> {
  body: T;
  etag: string;
}

function etagOf(db: Db, v: EntryViewer, version: string | undefined, body: unknown): string {
  return entryEtag([version, v.role, houseVersion(db, v.campaignId), digest(body)]);
}

/** `GET /api/compendium/rules` (FR-CMP-65): every server page with its card names. */
export function readRulesIndex(db: Db, v: EntryViewer): RulesRead<RulesIndexResponse> {
  const idx = searchIndex(db);
  const keys = bySourceKey(idx, v);
  const pages = [
    ...RULE_PAGES.map((p) => ({ id: p.id, title: p.title })),
    {
      id: HOUSE_PAGE_ID,
      title: "House rules",
    },
  ].map((p) => ({ ...p, cards: (pageRows(idx, v, p.id, keys) ?? []).map(summary) }));
  const src = bundledSourceRow(db);
  const body: RulesIndexResponse = {
    pages,
    attribution: src
      ? {
          key: src.key,
          name: src.name,
          licence: src.licence,
          attribution: src.attribution,
          url: src.url,
          version: src.version,
        }
      : null,
  };
  return { body, etag: etagOf(db, v, src?.version, body) };
}

/** `GET /api/compendium/rules/:pageId` (FR-CMP-65): the page's cards with text; null = 404. */
export function readRulesPage(
  db: Db,
  v: EntryViewer,
  pageId: string,
): RulesRead<{ id: string; cards: RuleCardBody[] }> | null {
  const idx = searchIndex(db);
  const rows = pageRows(idx, v, pageId);
  if (rows === null) return null;
  const ids = rows.map((r) => r.id);
  const texts = new Map(
    ids.length === 0
      ? []
      : db
          .select({ id: compendiumEntry.id, body: compendiumEntry.body })
          .from(compendiumEntry)
          .where(inArray(compendiumEntry.id, ids))
          .all()
          .map((r) => [r.id, (r.body as { text?: unknown } | null)?.text]),
  );
  const cards: RuleCardBody[] = rows.map((r) => {
    const text = texts.get(r.id);
    return {
      ...summary(r),
      text: typeof text === "string" ? text : "",
      house: r.source === null,
      shared: r.source !== null || r.shared,
    };
  });
  const body = { id: pageId, cards };
  return { body, etag: etagOf(db, v, bundledSourceRow(db)?.version, body) };
}
