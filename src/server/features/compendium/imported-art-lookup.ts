// FR-CMPX-24, reads: a monster's token file and the campaign's imported art. `placeTokenIn` uses
// them when a token is placed without an image, so this is a leaf module: it must not import
// scenes-map's commands or registries (they import it). The first ingest is `imported-art.ts`.
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { asset, compendiumEntry, entity, importedArt } from "../../db/schema";

/** A command's `tx` or the DB. */
type Read = Pick<Db, "select">;

export interface ArtSource {
  source: string;
  sourceKey: string;
  /** The monster's name: the asset's name (FR-CMPX-24). */
  name: string;
  artPath: string;
}

/** The token file of an imported definition's entry, as stored (the reader checks the path). */
export function artSourceOf(read: Read, definitionId: string): ArtSource | null {
  const def = read
    .select({ source: entity.source, sourceKey: entity.sourceKey })
    .from(entity)
    .where(eq(entity.id, definitionId))
    .get();
  if (!def?.source || !def.sourceKey) return null;
  const entry = read
    .select({ name: compendiumEntry.name, artPath: compendiumEntry.artPath })
    .from(compendiumEntry)
    .where(
      and(eq(compendiumEntry.source, def.source), eq(compendiumEntry.sourceKey, def.sourceKey)),
    )
    .get();
  if (!entry?.artPath) return null;
  return { source: def.source, sourceKey: def.sourceKey, name: entry.name, artPath: entry.artPath };
}

/** The campaign's imported art for a monster, if the row and its asset are both there. */
export function importedArtAsset(
  read: Read,
  campaignId: string,
  source: string,
  sourceKey: string,
): string | null {
  const row = read
    .select({ assetId: asset.id })
    .from(importedArt)
    .innerJoin(asset, eq(asset.id, importedArt.assetId))
    .where(
      and(
        eq(importedArt.campaignId, campaignId),
        eq(importedArt.source, source),
        eq(importedArt.sourceKey, sourceKey),
      ),
    )
    .get();
  return row?.assetId ?? null;
}

/** FR-CMPX-24: the art a token of this definition takes when placed with no image; null = none. */
export function importedArtOfDefinition(
  read: Read,
  campaignId: string,
  definitionId: string,
): string | null {
  const art = artSourceOf(read, definitionId);
  return art && importedArtAsset(read, campaignId, art.source, art.sourceKey);
}
