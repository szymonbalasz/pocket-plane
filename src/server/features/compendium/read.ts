// FR-CMP-12: one entry for a viewer: the entry, its source attribution and (monster) its
// definition's stat block, plus the ETag. Visibility first (FR-CMP-14): not visible → null, the
// same answer as an unknown id, before any conditional check. Image IDs (FR-CMP-47, -48) only
// after it, stale ones dropped (FR-ASSET-37); the ETag hashes them, never carries them.
import { createHash } from "node:crypto";
import { BOOK_SOURCE_PREFIX, sourceRank } from "@shared/compendium/match";
import { resolvePreset } from "@shared/compendium/presets";
import type { CreditsResponse, EntryResponse, SourceAttribution } from "@shared/compendium/rest";
import { CompendiumEntry } from "@shared/compendium/schemas";
import { and, eq, inArray, like } from "drizzle-orm";
import type { Db } from "../../db/client";
import { asset, compendiumEntry, compendiumSource, entity } from "../../db/schema";
import { toImportedRecord } from "../entities/rows";
import { inheritedPreset } from "./entries";
import { importedArtAsset } from "./imported-art-lookup";
import { searchIndex } from "./search-index";
import { type BookAbbrOf, bookAbbrOf } from "./sources/five-etools";
import { type EntryViewer, entryVisibleTo } from "./visibility";

export interface EntryRead {
  body: EntryResponse;
  etag: string;
}

/**
 * Strong ETag over entry `updatedAt` + source `version` (FR-CMP-12), for a monster its
 * definition's `updatedAt` (a re-import can update the definition alone), and the delivered image
 * IDs (FR-CMP-47: a dropped image changes it). An opaque hash: no part is readable from it.
 */
export function entryEtag(parts: readonly (string | null | undefined)[]): string {
  const h = createHash("sha256")
    .update(parts.map((p) => p ?? "").join("\u0000"))
    .digest("base64url");
  return `"${h.slice(0, 27)}"`;
}

/** `If-None-Match` matches `etag` (list, weak prefix, `*`). */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .some((t) => t === "*" || t === etag);
}

/** FR-CMP-47: the entry's image IDs that still have an asset row in its campaign, slot order. */
function liveImageIds(db: Db, campaignId: string | null, ids: readonly string[]): string[] {
  if (campaignId === null || ids.length === 0) return [];
  const live = new Set(
    db
      .select({ id: asset.id })
      .from(asset)
      .where(and(eq(asset.campaignId, campaignId), inArray(asset.id, [...ids])))
      .all()
      .map((r) => r.id),
  );
  return ids.filter((x) => live.has(x));
}

type SourceRow = typeof compendiumSource.$inferSelect;

function attributionOf(src: SourceRow, abbrOf: BookAbbrOf): SourceAttribution {
  const abbr = abbrOf(src.key, src.name);
  return {
    key: src.key,
    name: src.name,
    licence: src.licence,
    attribution: src.attribution,
    url: src.url,
    version: src.version,
    ...(abbr !== undefined ? { abbr } : {}),
  };
}

/**
 * FR-CMPX-18 (FR-CMP-19's About): the source of every entry this viewer may read, by rank then
 * name. Replaced entries still count: they stay readable, so their source stays credited.
 */
export function readCredits(db: Db, v: EntryViewer, abbrOf: BookAbbrOf): CreditsResponse {
  const keys = new Set<string>();
  for (const row of searchIndex(db).rows) {
    if (row.source !== null && !row.entryless && entryVisibleTo(row, v)) keys.add(row.source);
  }
  const rows = keys.size
    ? db
        .select()
        .from(compendiumSource)
        .where(inArray(compendiumSource.key, [...keys]))
        .all()
    : [];
  rows.sort((a, b) => sourceRank(a.key) - sourceRank(b.key) || a.name.localeCompare(b.name));
  const book = db
    .select({ key: compendiumSource.key })
    .from(compendiumSource)
    .where(like(compendiumSource.key, `${BOOK_SOURCE_PREFIX}%`))
    .get();
  return { sources: rows.map((r) => attributionOf(r, abbrOf)), bookArt: book !== undefined };
}

export function readEntry(
  db: Db,
  id: string,
  v: EntryViewer,
  abbrOf: BookAbbrOf = bookAbbrOf(null),
): EntryRead | null {
  const row = db.select().from(compendiumEntry).where(eq(compendiumEntry.id, id)).get();
  if (!row || !entryVisibleTo(row, v)) return null;
  const imageAssetIds = liveImageIds(db, row.campaignId, row.imageAssetIds);
  const entry = CompendiumEntry.parse({
    id: row.id,
    campaignId: row.campaignId,
    kind: row.kind,
    source: row.source,
    sourceKey: row.sourceKey,
    name: row.name,
    line: row.line,
    facets: row.facets,
    body: row.body,
    definitionId: row.definitionId,
    shared: row.shared,
    // Informational link; a player gets none (it may name an entry they can't see).
    derivedFromId: v.role === "dm" ? row.derivedFromId : null,
    imageAssetIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    importedAt: row.importedAt,
  });
  const src =
    row.source === null
      ? undefined
      : db.select().from(compendiumSource).where(eq(compendiumSource.key, row.source)).get();
  const source = src ? attributionOf(src, abbrOf) : null;
  const body: EntryResponse = { entry, source };
  // FR-CMPX-15: importing another source can change it, so it is part of the ETag.
  const inherited = resolvePreset(row) ? null : inheritedPreset(db, row);
  if (inherited) body.inheritedPreset = inherited.name;
  // FR-CMPX-28: changes when the first placement ingests, so it is part of the ETag.
  const art =
    v.role === "dm" && v.campaignId !== null && row.source !== null && row.sourceKey !== null
      ? importedArtAsset(db, v.campaignId, row.source, row.sourceKey)
      : null;
  if (art) body.importedArtAssetId = art;
  let defUpdatedAt: string | undefined;
  if (row.kind === "monster" && row.definitionId !== null) {
    const def = db.select().from(entity).where(eq(entity.id, row.definitionId)).get();
    if (def) {
      const rec = toImportedRecord(def);
      body.definition = { id: rec.id, name: rec.name, statBlock: rec.statBlock };
      defUpdatedAt = def.updatedAt;
    }
  }
  return {
    body,
    etag: entryEtag([
      row.updatedAt,
      src?.version,
      defUpdatedAt,
      imageAssetIds.join(","),
      ...(inherited ? [inherited.name] : []),
      ...(art ? [art] : []),
      ...(source?.abbr ? [source.abbr] : []),
    ]),
  };
}
