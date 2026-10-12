// `entities.import` (FR-ENT-06): the import pipeline's definition store + kinds (CON-03).
// Only path that writes rows with a source. No route, no intent (FR-FIX-24).
import { IMPORTED_ENTITY_TYPE, importData } from "@shared/entities/schemas";
import { EntityImported } from "@shared/events/entities";
import { and, eq } from "drizzle-orm";
import { entity } from "../../db/schema";
import type { DefinitionStore, ImportRegistry } from "../fixtures-adapters/import-pipeline";
import { getRow, toImportedRecord } from "./rows";

export const entitiesImport: DefinitionStore = {
  recordType: IMPORTED_ENTITY_TYPE,
  createdEvent: EntityImported,
  find(tx, source, sourceKey) {
    const row = tx
      .select({ id: entity.id })
      .from(entity)
      .where(and(eq(entity.source, source), eq(entity.sourceKey, sourceKey)))
      .get();
    return row ?? null;
  },
  insert(tx, r) {
    // The pipeline already parsed `data` with the kind's schema (`importData`).
    const data = r.data as { name: string; statBlock: unknown };
    tx.insert(entity)
      .values({
        id: r.id,
        kind: r.kind as "monster",
        campaignId: null,
        name: data.name,
        portraitAssetId: null,
        statBlock: data.statBlock,
        ownerPlayerId: null,
        hpCurrent: null,
        derivedFromId: null,
        source: r.source,
        sourceKey: r.sourceKey,
        licence: r.licence,
        attribution: r.attribution,
        importedAt: r.importedAt,
        createdAt: r.importedAt,
        updatedAt: r.importedAt,
      })
      .run();
    const row = getRow(tx, r.id);
    if (!row) throw new Error(`entities.import: row ${r.id} missing after insert`);
    return {
      record: toImportedRecord(row),
      payload: { entityId: r.id, source: r.source, sourceKey: r.sourceKey },
    };
  },
};

/** Plugs the `entity` table and the importable kinds into the pipeline. */
export function registerImport(reg: ImportRegistry): void {
  for (const [kind, schema] of Object.entries(importData)) reg.registerKind({ kind, schema });
  reg.store = entitiesImport;
}
