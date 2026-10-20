// Record types (CBT §9, protocol §20). Campaign scope; DM always full. Visibility fns read only
// the record and the viewer (FR-CBT-27).
import { healthBand, publicSideOf } from "@shared/combat-tracker/rules";
import {
  COMBATANT_TYPE,
  CombatantRecord,
  ENCOUNTER_ENTRY_TYPE,
  ENCOUNTER_TYPE,
  ENCOUNTER_WINDOW,
  EncounterEntryRecord,
  EncounterRecord,
  HIT_RULING_TYPE,
  HitRulingRecord,
  HP_CHANGE_TYPE,
  HP_CHANGE_WINDOW,
  HpChangeRecord,
  type PlayerCombatant,
  type PlayerEncounterRecord,
} from "@shared/combat-tracker/schemas";
import { cutWindow, type RecordWindow } from "@shared/protocol/window";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { combatant, encounter, encounterEntry, hpChange } from "../../db/schema";
import { defineRecordType, type Viewer, type Visibility } from "../../ws/records";
import {
  pendingRulings,
  startedEncounter,
  toCombatantRecord,
  toEncounterRecord,
  toEntryRecord,
  toHpChangeRecord,
} from "./rows";

export const encounterWindow: RecordWindow<EncounterRecord> = {
  orderBy: "seq",
  size: ENCOUNTER_WINDOW,
  pin: (r) => r.status !== "ended",
};

function campaignEncounters(db: Db, cid: string): EncounterRecord[] {
  return db
    .select()
    .from(encounter)
    .where(eq(encounter.campaignId, cid))
    .orderBy(asc(encounter.seq))
    .all()
    .map(toEncounterRecord);
}

export function encounterVisibility(r: EncounterRecord): Visibility {
  return r.status === "started" ? "redacted" : "hidden";
}

export function redactEncounter(r: EncounterRecord): PlayerEncounterRecord {
  return {
    id: r.id,
    status: r.status,
    round: r.round,
    playerTurnCombatantId: r.playerTurnCombatantId,
  };
}

/**
 * FR-CBT-27; sprint 6 (FR-CBT-116, ADR-0056): a companion of a hidden owner (`ownerHidden`) is
 * hidden from every player, the owner included, like a hidden or inactive one.
 */
export function combatantVisibility(r: CombatantRecord, _v?: Viewer): Visibility {
  return !r.active || r.hidden || r.ownerHidden ? "hidden" : "redacted";
}

/**
 * FR-CBT-37: removed → no rank, band or initiative; else the PC / monster redaction. FR-CBT-100
 * (#252): `side` = the side players were last openly shown; the true side never. Sprint 6
 * (FR-CBT-116): a companion adds its owner ids and mode for everyone, and for its **owner** (the
 * viewer is `ownerPlayerId`) also HP, temp HP, `pet` and `card`; `ownerHidden` and
 * `concentrationEffectId` never.
 */
export function redactCombatant(r: CombatantRecord, v?: Viewer): PlayerCombatant {
  const base = {
    id: r.id,
    encounterId: r.encounterId,
    tokenId: r.tokenId,
    name: r.name,
    imageAssetId: r.imageAssetId,
    movedFt: r.movedFt,
    side: publicSideOf(r),
  };
  if (r.removed) return { ...base, kind: r.kind, removed: true };
  const ranked = { ...base, playerPosition: r.playerPosition, removed: false as const };
  if (r.kind === "pc") {
    return { ...ranked, kind: "pc", entityId: r.entityId, initiative: r.initiative };
  }
  const monster = {
    ...ranked,
    kind: "monster" as const,
    band: healthBand(r.hpCurrent ?? 0, r.hpMax ?? 1),
  };
  if (r.ownerCharacterId === null || r.ownerPlayerId === null || r.turnMode === null) {
    return monster;
  }
  const owned = {
    ...monster,
    ownerCharacterId: r.ownerCharacterId,
    ownerPlayerId: r.ownerPlayerId,
    turnMode: r.turnMode,
  };
  if (v?.playerId !== r.ownerPlayerId) return owned;
  return {
    ...owned,
    hpCurrent: r.hpCurrent,
    hpMax: r.hpMax,
    tempHp: r.tempHp,
    pet: r.pet,
    card: r.card,
  };
}

export const combatRecordTypes = [
  defineRecordType<EncounterRecord>({
    type: ENCOUNTER_TYPE,
    scope: "campaign",
    schema: EncounterRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    visibility: encounterVisibility,
    redact: redactEncounter,
    snapshot: ({ db }, v) => campaignEncounters(db, v.campaignId),
    window: encounterWindow,
  }),
  defineRecordType<EncounterEntryRecord>({
    type: ENCOUNTER_ENTRY_TYPE,
    scope: "campaign",
    audience: "dm",
    schema: EncounterEntryRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    visibility: () => "hidden",
    snapshot: ({ db }, v) => {
      const ids = cutWindow(campaignEncounters(db, v.campaignId), encounterWindow).rows.map(
        (e) => e.id,
      );
      if (ids.length === 0) return [];
      return db
        .select()
        .from(encounterEntry)
        .where(inArray(encounterEntry.encounterId, ids))
        .orderBy(asc(encounterEntry.seq))
        .all()
        .map((r) => toEntryRecord(r, v.campaignId));
    },
  }),
  defineRecordType<CombatantRecord>({
    type: COMBATANT_TYPE,
    scope: "campaign",
    schema: CombatantRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    visibility: combatantVisibility,
    redact: redactCombatant,
    snapshot: ({ db }, v) => {
      const enc = startedEncounter(db, v.campaignId);
      if (!enc) return [];
      return db
        .select()
        .from(combatant)
        .where(eq(combatant.encounterId, enc.id))
        .orderBy(asc(combatant.seq))
        .all()
        .map(toCombatantRecord);
    },
  }),
  defineRecordType<HpChangeRecord>({
    type: HP_CHANGE_TYPE,
    scope: "campaign",
    audience: "dm",
    schema: HpChangeRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    visibility: () => "hidden",
    snapshot: ({ db }, v) => {
      const enc = startedEncounter(db, v.campaignId);
      if (!enc) return [];
      // The newest 50 by seq, cut in SQL (#163), oldest first; the registry's cut keeps them.
      return db
        .select()
        .from(hpChange)
        .where(and(eq(hpChange.campaignId, v.campaignId), eq(hpChange.encounterId, enc.id)))
        .orderBy(desc(hpChange.seq))
        .limit(HP_CHANGE_WINDOW)
        .all()
        .reverse()
        .map(toHpChangeRecord);
    },
    window: { orderBy: "seq", size: HP_CHANGE_WINDOW },
  }),
  // FR-CBT-88, -91 (sprint 5, ADR-0053): DM only; the started encounter's rulings whose card is
  // pending (≤ 1 per card). Live: Apply, Dismiss and End send the delete, Undo the upsert.
  defineRecordType<HitRulingRecord>({
    type: HIT_RULING_TYPE,
    scope: "campaign",
    audience: "dm",
    schema: HitRulingRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    visibility: () => "hidden",
    snapshot: ({ db }, v) => {
      const enc = startedEncounter(db, v.campaignId);
      return enc ? pendingRulings({ tx: db }, enc.id) : [];
    },
  }),
];
