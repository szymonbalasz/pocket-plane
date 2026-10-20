// Row ↔ record mapping for `entity` (ENT §8, §9). Reads re-validate the JSON leaf (FR-ENT-01).
import {
  type DefinitionRecord,
  EntityRecord,
  ImportedEntityRecord,
} from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { entity } from "../../db/schema";

export type EntityRow = typeof entity.$inferSelect;

/** A stored row fails its schema (FR-ENT-01): snapshot omits it, a command answers `internal`. */
export class InvalidStoredEntity extends Error {
  override name = "InvalidStoredEntity";
  constructor(readonly entityId: string) {
    super(`Stored entity ${entityId} fails its schema`);
  }
}

const base = (r: EntityRow) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  portraitAssetId: r.portraitAssetId,
  tokenShape: r.tokenShape,
  statBlock: r.statBlock,
  ownerPlayerId: r.ownerPlayerId,
  hpCurrent: r.hpCurrent,
  // Character play state (combat-extras); the monster / imported schemas strip them.
  tempHp: r.tempHp,
  deathSuccesses: r.deathSuccesses,
  deathFailures: r.deathFailures,
  derivedFromId: r.derivedFromId,
  // Pet fields (sprint 6, FR-ENT-31 / -37); the character / imported schemas strip them.
  companionOf: r.companionOf,
  turnMode: r.turnMode,
  petPresent: r.petPresent,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Campaign row → `entity` wire record (row minus provenance). Throws `InvalidStoredEntity`. */
export function toEntityRecord(r: EntityRow): EntityRecord {
  const p = EntityRecord.safeParse({ ...base(r), campaignId: r.campaignId });
  if (!p.success || r.campaignId === null) throw new InvalidStoredEntity(r.id);
  return p.data;
}

/** Imported row → `imported-entity` wire record (incl. provenance). */
export function toImportedRecord(r: EntityRow): ImportedEntityRecord {
  const p = ImportedEntityRecord.safeParse({
    ...base(r),
    campaignId: r.campaignId,
    source: r.source,
    sourceKey: r.sourceKey,
    licence: r.licence,
    attribution: r.attribution,
    importedAt: r.importedAt,
  });
  if (!p.success) throw new InvalidStoredEntity(r.id);
  return p.data;
}

export const isImportedRow = (r: EntityRow) => r.campaignId === null;

export function toDefinitionRecord(r: EntityRow): DefinitionRecord {
  return isImportedRow(r) ? toImportedRecord(r) : toEntityRecord(r);
}

/** Record type of a row's sync record. */
export const recordTypeOf = (r: EntityRow) => (isImportedRow(r) ? "imported-entity" : "entity");

export function getRow(tx: Tx, id: string): EntityRow | undefined {
  return tx.select().from(entity).where(eq(entity.id, id)).get();
}
