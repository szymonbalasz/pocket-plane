// FR-CMPX-24, reuse half: the campaign already holds a monster's art → a token placed without an
// image takes it in the placing command's transaction (the scene visibility hooks' `rederive` line:
// placement runs no token-changed hooks, FR-MAP-30; the row rides on the same event). Also serves
// every `placeTokenIn` caller. Leaf module: it must not import scenes-map's commands or registries
// (they import it). The first ingest is `imported-art.ts`.
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import { asset, compendiumEntry, entity, importedArt, token } from "../../db/schema";
import { readToken } from "../scenes-map/rows";
import type { SceneRead, SceneVisibilityHook } from "../scenes-map/visibility-hooks";

export interface ArtSource {
  source: string;
  sourceKey: string;
  /** The monster's name: the asset's name (FR-CMPX-24). */
  name: string;
  artPath: string;
}

/** The token file of an imported definition's entry, as stored (the reader checks the path). */
export function artSourceOf(read: SceneRead, definitionId: string): ArtSource | null {
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
  read: SceneRead,
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

export const importedArtVisibilityHook: SceneVisibilityHook = {
  name: "compendium.imported-art",
  rederive(env, change) {
    if (change.type !== TOKEN_TYPE || change.before !== null || change.after === null) return [];
    const placed = change.after as TokenRecord;
    if (placed.imageAssetId !== null) return [];
    const art = artSourceOf(env.tx, placed.definitionId);
    if (!art) return [];
    const assetId = importedArtAsset(env.tx, placed.campaignId, art.source, art.sourceKey);
    if (!assetId) return [];
    env.tx.update(token).set({ imageAssetId: assetId }).where(eq(token.id, placed.id)).run();
    return [
      { type: TOKEN_TYPE, id: placed.id, before: placed, after: readToken(env.tx, placed.id) },
    ];
  },
};
