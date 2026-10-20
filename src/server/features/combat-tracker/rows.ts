// Row ↔ record converters and loaders for combat-tracker. Campaign = `actor.campaignId`.
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  ENCOUNTER_ENTRY_TYPE,
  ENCOUNTER_TYPE,
  type EncounterEntryRecord,
  type EncounterRecord,
  HIT_RULING_TYPE,
  type HitRulingRecord,
  HP_CHANGE_TYPE,
  type HpChangeRecord,
} from "@shared/combat-tracker/schemas";
import type { StatBlock } from "@shared/entities/schemas";
import { and, asc, eq, inArray } from "drizzle-orm";
import { conflict, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import {
  combatant,
  encounter,
  encounterEntry,
  entity,
  hitRuling,
  hpChange,
  notification,
} from "../../db/schema";
import type { Actor, RecordChange } from "../../events/types";

type Read = Pick<Tx, "select">;

export const toEncounterRecord = (r: typeof encounter.$inferSelect): EncounterRecord => ({
  ...r,
  partyCharacterIds: (r.partyCharacterIds as string[] | null) ?? null,
});
export const toEntryRecord = (
  r: typeof encounterEntry.$inferSelect,
  campaignId: string,
): EncounterEntryRecord => ({ ...r, campaignId });
/** FR-CBT-107 (sprint 6): stored `position` 0 = no rank (an in-owner-turn companion) → null. */
export const toCombatantRecord = (r: typeof combatant.$inferSelect): CombatantRecord => ({
  ...r,
  position: r.position === 0 ? null : r.position,
});
export const toHpChangeRecord = (r: typeof hpChange.$inferSelect): HpChangeRecord => ({
  ...r,
  rollIds: r.rollIds as string[],
});

export const toHitRulingRecord = (r: typeof hitRuling.$inferSelect): HitRulingRecord => ({ ...r });

export function campaignOf(actor: Actor): string {
  if (!actor.campaignId) throw conflict("No active campaign");
  return actor.campaignId;
}

export const change = <T extends { id: string }>(
  type: string,
  before: T | null,
  after: T | null,
): RecordChange => ({ type, id: (after ?? before)?.id as string, before, after });

export const encounterChange = (b: EncounterRecord | null, a: EncounterRecord | null) =>
  change(ENCOUNTER_TYPE, b, a);
export const entryChange = (b: EncounterEntryRecord | null, a: EncounterEntryRecord | null) =>
  change(ENCOUNTER_ENTRY_TYPE, b, a);
export const combatantChange = (b: CombatantRecord | null, a: CombatantRecord | null) =>
  change(COMBATANT_TYPE, b, a);
export const hpChangeChange = (b: HpChangeRecord | null, a: HpChangeRecord | null) =>
  change(HP_CHANGE_TYPE, b, a);
export const hitRulingChange = (b: HitRulingRecord | null, a: HitRulingRecord | null) =>
  change(HIT_RULING_TYPE, b, a);

/** The encounter's hit rulings whose card is pending (the `hit-ruling` snapshot), card order. */
export function pendingRulings(env: { tx: Read }, encounterId: string): HitRulingRecord[] {
  return env.tx
    .select({ r: hitRuling })
    .from(hitRuling)
    .innerJoin(notification, eq(notification.id, hitRuling.cardId))
    .where(and(eq(hitRuling.encounterId, encounterId), eq(notification.state, "pending")))
    .orderBy(asc(notification.seq))
    .all()
    .map(({ r }) => toHitRulingRecord(r));
}

/** The card's hit ruling (FR-CBT-88), or null. */
export function rulingOfCard(tx: Read, cardId: string): HitRulingRecord | null {
  const r = tx.select().from(hitRuling).where(eq(hitRuling.cardId, cardId)).get();
  return r ? toHitRulingRecord(r) : null;
}

export function readEncounter(tx: Read, id: string): EncounterRecord {
  return toEncounterRecord(
    tx.select().from(encounter).where(eq(encounter.id, id)).get() as typeof encounter.$inferSelect,
  );
}

/** An encounter of the campaign, or `not_found`. */
export function getEncounter(tx: Read, cid: string, id: string): EncounterRecord {
  const r = tx
    .select()
    .from(encounter)
    .where(and(eq(encounter.id, id), eq(encounter.campaignId, cid)))
    .get();
  if (!r) throw notFound("Encounter not found");
  return toEncounterRecord(r);
}

export function startedEncounter(tx: Read, cid: string): EncounterRecord | null {
  const r = tx
    .select()
    .from(encounter)
    .where(and(eq(encounter.campaignId, cid), eq(encounter.status, "started")))
    .get();
  return r ? toEncounterRecord(r) : null;
}

export function entriesOf(
  tx: Read,
  enc: { id: string; campaignId: string },
): EncounterEntryRecord[] {
  return tx
    .select()
    .from(encounterEntry)
    .where(eq(encounterEntry.encounterId, enc.id))
    .orderBy(asc(encounterEntry.seq))
    .all()
    .map((r) => toEntryRecord(r, enc.campaignId));
}

export function combatantsOf(tx: Read, encounterId: string): CombatantRecord[] {
  return tx
    .select()
    .from(combatant)
    .where(eq(combatant.encounterId, encounterId))
    .orderBy(asc(combatant.seq))
    .all()
    .map(toCombatantRecord);
}

export function readCombatant(tx: Read, id: string): CombatantRecord {
  return toCombatantRecord(
    tx.select().from(combatant).where(eq(combatant.id, id)).get() as typeof combatant.$inferSelect,
  );
}

/** A combatant of the campaign, or `not_found`. */
export function getCombatant(tx: Read, cid: string, id: string): CombatantRecord {
  const r = tx
    .select()
    .from(combatant)
    .where(and(eq(combatant.id, id), eq(combatant.campaignId, cid)))
    .get();
  if (!r) throw notFound("Combatant not found");
  return toCombatantRecord(r);
}

/** Stat blocks (stored JSON) by entity id; the caller applies `effectiveStats`. */
export function statBlocks(
  tx: Read,
  ids: readonly string[],
): Map<string, { statBlock: StatBlock }> {
  if (ids.length === 0) return new Map();
  return new Map(
    tx
      .select({ id: entity.id, statBlock: entity.statBlock })
      .from(entity)
      .where(inArray(entity.id, [...new Set(ids)]))
      .all()
      .map((r) => [r.id, { statBlock: r.statBlock as StatBlock }]),
  );
}

export function readHpChange(tx: Read, id: string): HpChangeRecord {
  return toHpChangeRecord(
    tx.select().from(hpChange).where(eq(hpChange.id, id)).get() as typeof hpChange.$inferSelect,
  );
}
