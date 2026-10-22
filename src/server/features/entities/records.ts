// Record types `entity` (campaign) and `imported-entity` (global, lazy by ids: FR-CMP-15)
// (ENT §9, FR-ENT-15/16).
import { deathStateOf } from "@shared/combat-extras/rules";
import { healthBand } from "@shared/combat-tracker/rules";
import {
  type CharacterRecord,
  ENTITY_TYPE,
  type EntityRecord,
  EntityRecord as EntityRecordSchema,
  IMPORTED_ENTITY_TYPE,
  type ImportedEntityRecord,
  ImportedEntityRecord as ImportedSchema,
  isPet,
  type MonsterRecord,
  type OWNER_PET_OMITTED,
  REDACTED_CHARACTER_KEYS,
  REDACTED_PET_KEYS,
  type RedactedCharacter,
  type RedactedPet,
} from "@shared/entities/schemas";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { entity } from "../../db/schema";
import type { Logger } from "../../log";
import { defineRecordType, type Viewer, type Visibility } from "../../ws/records";
import { type EntityRow, InvalidStoredEntity, toEntityRecord, toImportedRecord } from "./rows";

/**
 * FR-ENT-15: own character full; other characters redacted; monsters hidden. Sprint 6 (FR-ENT-37,
 * ADR-0056): a **pet** → its owner the full row minus `derivedFromId` / `petPresent` (redacted
 * form), other players `RedactedPet` only while `petPresent`, else hidden.
 */
export function entityVisibility(r: EntityRecord, v: Viewer): Visibility {
  if (r.kind === "character") return r.ownerPlayerId === v.playerId ? "full" : "redacted";
  if (!isPet(r)) return "hidden";
  if (r.ownerPlayerId !== null && r.ownerPlayerId === v.playerId) return "redacted";
  return r.petPresent ? "redacted" : "hidden";
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
  // #154: the PC Down indicator for everyone.
  down: (r) => r.hpCurrent === 0,
  level: (r) => r.statBlock.level,
  className: (r) => r.statBlock.className,
  species: (r) => r.statBlock.species ?? null,
  // FR-CBTX-32: the derived state only; never the counters.
  deathState: (r) => deathStateOf(r.hpCurrent, r.deathSuccesses, r.deathFailures),
  // ADR-0063 (FR-PARTY-52): party status; a PC hidden from players still shows them (OQ-PARTY-31 A).
  hpCurrent: (r) => r.hpCurrent,
  hpMax: (r) => r.statBlock.hpMax,
  tempHp: (r) => r.tempHp,
  ac: (r) => r.statBlock.ac,
};

/** FR-ENT-37: another player's present pet, by the pet whitelist (`RedactedPet`). */
const REDACT_PET: { [K in keyof RedactedPet]-?: (r: MonsterRecord) => RedactedPet[K] } = {
  id: (r) => r.id,
  kind: (r) => r.kind,
  name: (r) => r.name,
  portraitAssetId: (r) => r.portraitAssetId,
  ownerPlayerId: (r) => r.ownerPlayerId as string,
  companionOf: (r) => r.companionOf as string,
  // FR-CBT-26's band on the kept HP; never the numbers.
  band: (r) => healthBand(r.hpCurrent ?? 0, r.statBlock.hpMax),
};

/** `entity` redaction: other characters (whitelist) and pets (FR-ENT-37) by the viewer. */
export function redactEntity(
  r: EntityRecord,
  v: Viewer,
): RedactedCharacter | RedactedPet | Omit<MonsterRecord, (typeof OWNER_PET_OMITTED)[number]> {
  if (r.kind === "character") return redactCharacter(r);
  if (r.ownerPlayerId !== null && r.ownerPlayerId === v.playerId) {
    const { derivedFromId: _d, petPresent: _p, ...own } = r;
    return own;
  }
  const out: Record<string, unknown> = {};
  for (const k of REDACTED_PET_KEYS) out[k] = REDACT_PET[k](r);
  return out as RedactedPet;
}

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
    redact: redactEntity,
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
    // FR-CMP-15 (ADR-0045): in no snapshot; the DM loads definitions by id (`sync.load`).
    lazy: "ids",
    byIds: ({ db }, _v, ids) =>
      mapValid(
        db
          .select()
          .from(entity)
          .where(and(isNull(entity.campaignId), inArray(entity.id, [...ids])))
          .orderBy(asc(sql`rowid`))
          .all(),
        toImportedRecord,
        log,
      ),
    snapshot: ({ db }) =>
      mapValid(
        db.select().from(entity).where(isNull(entity.campaignId)).orderBy(asc(sql`rowid`)).all(),
        toImportedRecord,
        log,
      ),
  });

  return [entityType, importedType] as const;
}
