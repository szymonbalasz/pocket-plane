// FR-CMP-12: one entry for a viewer: the entry, its source attribution and (monster) its
// definition's stat block, plus the ETag. Visibility first (FR-CMP-14): not visible → null, the
// same answer as an unknown id, before any conditional check. Image IDs (FR-CMP-47, -48) only
// after it, stale ones dropped (FR-ASSET-37); the ETag hashes them, never carries them.
import { createHash } from "node:crypto";
import type { EntryResponse } from "@shared/compendium/rest";
import { CompendiumEntry } from "@shared/compendium/schemas";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { asset, compendiumEntry, compendiumSource, entity } from "../../db/schema";
import { toImportedRecord } from "../entities/rows";
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

export function readEntry(db: Db, id: string, v: EntryViewer): EntryRead | null {
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
  const body: EntryResponse = {
    entry,
    source: src
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
    etag: entryEtag([row.updatedAt, src?.version, defUpdatedAt, imageAssetIds.join(",")]),
  };
}
