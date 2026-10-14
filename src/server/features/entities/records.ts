// Record types `entity` (campaign) and `imported-entity` (global) (ENT §9, FR-ENT-15/16).
import { deathStateOf } from "@shared/combat-extras/rules";
import {
  type CharacterRecord,
  ENTITY_TYPE,
  type EntityRecord,
  EntityRecord as EntityRecordSchema,
  IMPORTED_ENTITY_TYPE,
  type ImportedEntityRecord,
  ImportedEntityRecord as ImportedSchema,
  REDACTED_CHARACTER_KEYS,
  type RedactedCharacter,
} from "@shared/entities/schemas";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { entity } from "../../db/schema";
import type { Logger } from "../../log";
import { defineRecordType, type Viewer, type Visibility } from "../../ws/records";
import { type EntityRow, InvalidStoredEntity, toEntityRecord, toImportedRecord } from "./rows";

/** FR-ENT-15: own character full; other characters redacted; monsters hidden. */
export function entityVisibility(r: EntityRecord, v: Viewer): Visibility {
  if (r.kind !== "character") return "hidden";
  return r.ownerPlayerId === v.playerId ? "full" : "redacted";
}

/**
 * The one whitelist (ADR-0036 "Refines ADR-0024", FR-CHARX-35): one entry per key of
 * `RedactedCharacter`, nothing else. A key whose value is `undefined` is left out.
 */
const REDACT: { [K in keyof RedactedCharacter]-?: (r: CharacterRecord) => RedactedCharacter[K] } = {
  id: (r) => r.id,
  kind: (r) => r.kind,
  name: (r) => r.name,
  portraitAssetId: (r) => r.portraitAssetId,
  ownerPlayerId: (r) => r.ownerPlayerId,
  // #154: the PC Down indicator for everyone; the HP number stays private.
  down: (r) => r.hpCurrent === 0,
  level: (r) => r.statBlock.level,
  className: (r) => r.statBlock.className,
  species: (r) => r.statBlock.species ?? null,
  // FR-CBTX-32: the derived state only; never the counters or temp HP.
  deathState: (r) => deathStateOf(r.hpCurrent, r.deathSuccesses, r.deathFailures),
};

export function redactCharacter(r: EntityRecord): RedactedCharacter {
  if (r.kind !== "character") throw new Error("Only characters are redacted");
  const out: Record<string, unknown> = {};
  for (const k of REDACTED_CHARACTER_KEYS) {
    const v = REDACT[k](r);
    if (v !== undefined) out[k] = v;
  }
  return out as RedactedCharacter;
}

/** Maps rows, omitting (and logging) rows that fail their schema (FR-ENT-01). */
function mapValid<R>(rows: EntityRow[], map: (r: EntityRow) => R, log: Logger): R[] {
  const out: R[] = [];
  for (const row of rows) {
    try {
      out.push(map(row));
    } catch (err) {
      if (!(err instanceof InvalidStoredEntity)) throw err;
      log.error(`entities: stored entity ${row.id} is invalid; omitted from the snapshot`);
    }
  }
  return out;
}

export function entityRecordTypes(log: Logger) {
  const entityType = defineRecordType<EntityRecord>({
    type: ENTITY_TYPE,
    scope: "campaign",
    schema: EntityRecordSchema,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    visibility: entityVisibility,
    redact: redactCharacter,
    // The campaign's characters + customs (≤ ~20, ENT §12); order not significant.
    snapshot: ({ db }, v) =>
      mapValid(
        db
          .select()
          .from(entity)
          .where(eq(entity.campaignId, v.campaignId))
          .orderBy(asc(sql`rowid`))
          .all(),
        toEntityRecord,
        log,
      ),
  });

  const importedType = defineRecordType<ImportedEntityRecord>({
    type: IMPORTED_ENTITY_TYPE,
    scope: "global",
    // FR-ENT-16 + ADR-0024: players never receive it, not even an empty list.
    audience: "dm",
    schema: ImportedSchema,
    idOf: (r) => r.id,
    visibility: () => "hidden",
    snapshot: ({ db }) =>
      mapValid(
        db.select().from(entity).where(isNull(entity.campaignId)).orderBy(asc(sql`rowid`)).all(),
        toImportedRecord,
        log,
      ),
  });

  return [entityType, importedType] as const;
}
