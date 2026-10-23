// Reminder rows → records (REM §8), and the writes other features make in their own transaction:
// the `linkHidden` copy after a stronghold / facility `dmOnly` change (FR-REM-06) and the removal
// with the source (FR-REM-11). Changes ride on the caller's event.
import { REMINDER_TYPE, type ReminderRecord } from "@shared/reminders/schemas";
import type { StrongholdRecord } from "@shared/strongholds/schemas";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import type { Db, Tx } from "../../db/client";
import { reminder } from "../../db/schema";
import type { RecordChange } from "../../events/types";

type Reader = Pick<Db | Tx, "select">;
type Row = typeof reminder.$inferSelect;

export function toReminderRecord(r: Row): ReminderRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    seq: r.seq,
    characterId: r.characterId,
    text: r.text,
    source: r.source,
    rolls: r.rolls,
    strongholdId: r.strongholdId,
    facilityId: r.facilityId,
    dmOnly: r.dmOnly,
    ownerPlayerId: r.ownerPlayerId,
    linkHidden: r.linkHidden,
    createdByPlayerId: r.createdByPlayerId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function getReminder(db: Reader, campaignId: string, id: string): ReminderRecord | null {
  const row = db
    .select()
    .from(reminder)
    .where(and(eq(reminder.id, id), eq(reminder.campaignId, campaignId)))
    .get();
  return row ? toReminderRecord(row) : null;
}

/** Every reminder of the campaign, `seq` order (the lazy provider; FR-REM-01). */
export function listReminders(db: Reader, campaignId: string): ReminderRecord[] {
  return db
    .select()
    .from(reminder)
    .where(eq(reminder.campaignId, campaignId))
    .orderBy(asc(reminder.seq))
    .all()
    .map(toReminderRecord);
}

/** FR-REM-03: the campaign's count and one target's (`characterId` null = the party). */
export function reminderCounts(
  db: Reader,
  campaignId: string,
  characterId: string | null,
): { campaign: number; target: number } {
  const all = db
    .select({ characterId: reminder.characterId, n: count() })
    .from(reminder)
    .where(eq(reminder.campaignId, campaignId))
    .groupBy(reminder.characterId)
    .all();
  return {
    campaign: all.reduce((n, r) => n + r.n, 0),
    target: all.find((r) => r.characterId === characterId)?.n ?? 0,
  };
}

/** Reminders linked to a stronghold (and, if given, one of its facilities), `seq` order. */
export function linkedReminders(
  db: Reader,
  campaignId: string,
  strongholdId: string,
  facilityId?: string,
): ReminderRecord[] {
  return db
    .select()
    .from(reminder)
    .where(
      and(
        eq(reminder.campaignId, campaignId),
        eq(reminder.strongholdId, strongholdId),
        facilityId === undefined ? undefined : eq(reminder.facilityId, facilityId),
      ),
    )
    .orderBy(asc(reminder.seq))
    .all()
    .map(toReminderRecord);
}

/** FR-REM-06: the copy a link gets from the stronghold as it is now. */
export function linkHiddenOf(
  hold: Pick<StrongholdRecord, "dmOnly" | "facilities">,
  facilityId: string | null,
): boolean {
  if (hold.dmOnly) return true;
  return facilityId !== null && hold.facilities.some((f) => f.id === facilityId && f.dmOnly);
}

/**
 * FR-REM-06: rewrites `linkHidden` on the stronghold's reminders whose copy changed (in the HOLD
 * command's transaction); their upserts / deletes ride on its event.
 */
export function refreshLinkHidden(
  env: Pick<CommandEnv, "tx" | "ctx">,
  hold: StrongholdRecord,
): RecordChange[] {
  const out: RecordChange[] = [];
  for (const r of linkedReminders(env.tx, hold.campaignId, hold.id)) {
    const linkHidden = linkHiddenOf(hold, r.facilityId);
    if (linkHidden === r.linkHidden) continue;
    env.tx
      .update(reminder)
      .set({ linkHidden, updatedAt: env.ctx.clock.iso() })
      .where(eq(reminder.id, r.id))
      .run();
    out.push({
      type: REMINDER_TYPE,
      id: r.id,
      before: r,
      after: getReminder(env.tx, hold.campaignId, r.id),
    });
  }
  return out;
}

/** FR-REM-11: deletes the given reminders; their deletes and ids for the caller's event. */
export function deleteReminders(
  env: Pick<CommandEnv, "tx">,
  rows: readonly ReminderRecord[],
): { ids: string[]; changes: RecordChange[] } {
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) env.tx.delete(reminder).where(inArray(reminder.id, ids)).run();
  return {
    ids,
    changes: rows.map((r) => ({ type: REMINDER_TYPE, id: r.id, before: r, after: null })),
  };
}
