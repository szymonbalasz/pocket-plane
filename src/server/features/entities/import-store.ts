// `entities.import` (FR-ENT-06): the import pipeline's store for kind `monster` (CON-03).
// Only path that writes rows with a source. No route, no intent (FR-FIX-24).
// In-place update of a changed imported definition (compendium FR-CMP-08, OQ-FIX-18): the row
// changes, then entities' definition-changed hooks run over its instances in every campaign.
import { type EntityRecord, IMPORTED_ENTITY_TYPE, importData } from "@shared/entities/schemas";
import { EntityImported, ImportedEntityUpdated } from "@shared/events/entities";
import { and, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { RecordRegistry } from "../../ws/records";
import {
  dataHash,
  type ImportRegistry,
  type ImportStore,
} from "../fixtures-adapters/import-pipeline";
import type { DefinitionHooks } from "./definition-hooks";
import { type EntityRow, getRow, toImportedRecord } from "./rows";

/** The stored import data (`importData.monster`): what the hash covers. */
const storedData = (r: EntityRow) => ({ name: r.name, statBlock: r.statBlock });

function imported(env: CommandEnv, id: string) {
  const row = getRow(env.tx, id);
  if (!row) throw new Error(`entities.import: row ${id} missing`);
  return toImportedRecord(row);
}

/**
 * FR-CMP-08: hook-changed instance rows by campaign (registry `campaignOf`), in first-seen order;
 * a global or unregistered type lands under `null` (logged with the definition).
 */
function byCampaign(records: RecordRegistry, changes: RecordChange[]) {
  const groups = new Map<string | null, RecordChange[]>();
  for (const ch of changes) {
    const rec = ch.after ?? ch.before;
    const cid = records.get(ch.type)?.campaignOf?.(rec) ?? null;
    const list = groups.get(cid) ?? [];
    groups.set(cid, list);
    list.push(ch);
  }
  return groups;
}

export function entitiesImportStore(records: RecordRegistry, hooks: DefinitionHooks): ImportStore {
  return {
    name: "entities",
    find(tx, source, sourceKey) {
      const row = tx
        .select()
        .from(entity)
        .where(and(eq(entity.source, source), eq(entity.sourceKey, sourceKey)))
        .get();
      return row ? { id: row.id, dataHash: dataHash(storedData(row)) } : null;
    },
    insert(env, r) {
      // The pipeline already parsed `data` with the kind's schema (`importData`).
      const data = r.data as { name: string; statBlock: unknown };
      env.tx
        .insert(entity)
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
      env.emit({
        type: EntityImported.type,
        campaignId: null,
        payload: { entityId: r.id, source: r.source, sourceKey: r.sourceKey },
        changes: [
          { type: IMPORTED_ENTITY_TYPE, id: r.id, before: null, after: imported(env, r.id) },
        ],
      });
    },
    update(env, id, r) {
      const data = r.data as { name: string; statBlock: unknown };
      const before = imported(env, id);
      env.tx
        .update(entity)
        .set({
          name: data.name,
          statBlock: data.statBlock,
          licence: r.licence,
          attribution: r.attribution,
          importedAt: r.importedAt,
          updatedAt: r.importedAt,
        })
        .where(eq(entity.id, id))
        .run();
      const after = imported(env, id);
      // FR-ENT-19 over every campaign's instances. Hooks read id, kind, statBlock and portrait,
      // which an imported record shares with a campaign one; none reads `campaignId` here.
      const hookChanges = hooks.run(
        { tx: env.tx, ctx: env.ctx, actor: env.actor },
        before as unknown as EntityRecord,
        after as unknown as EntityRecord,
      );
      const groups = byCampaign(records, hookChanges);
      env.emit({
        type: ImportedEntityUpdated.type,
        campaignId: null,
        payload: { entityId: id },
        changes: [{ type: IMPORTED_ENTITY_TYPE, id, before, after }, ...(groups.get(null) ?? [])],
      });
      // One log row per affected campaign with that campaign's changes (FR-CMP-08).
      for (const [campaignId, changes] of groups) {
        if (campaignId === null) continue;
        env.emit({
          type: ImportedEntityUpdated.type,
          campaignId,
          payload: { entityId: id },
          changes,
        });
      }
    },
  };
}

/** Plugs the `entity` table and the importable kinds into the pipeline. */
export function registerImport(
  reg: ImportRegistry,
  records: RecordRegistry,
  hooks: DefinitionHooks,
): void {
  const store = entitiesImportStore(records, hooks);
  for (const [kind, schema] of Object.entries(importData))
    reg.registerKind({ kind, schema, store });
}
