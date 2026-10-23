// reminders' definition-changed hook line (FR-REM-05; entities' registry): a PC's owner change, in
// the update's transaction, rewrites the `ownerPlayerId` copy on that character's reminders. The
// hook never emits: the changes ride on `EntityUpdated`, so the old owner gets deletes and the new
// owner upserts (FR-REM-13). A player's row keeps `createdByPlayerId`: its creator loses edit rights.
import type { EntityRecord } from "@shared/entities/schemas";
import { REMINDER_TYPE } from "@shared/reminders/schemas";
import { and, asc, eq } from "drizzle-orm";
import { reminder } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { HookEnv } from "../entities/definition-hooks";
import { getReminder, toReminderRecord } from "./rows";

export function reminderOwnerHook(
  env: HookEnv,
  before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  if (after.kind !== "character") return [];
  const to = after.ownerPlayerId ?? null;
  if ((before.ownerPlayerId ?? null) === to) return [];
  const cid = after.campaignId;
  const rows = env.tx
    .select()
    .from(reminder)
    .where(and(eq(reminder.campaignId, cid), eq(reminder.characterId, after.id)))
    .orderBy(asc(reminder.seq))
    .all()
    .map(toReminderRecord);
  return rows.map((r) => {
    env.tx
      .update(reminder)
      .set({ ownerPlayerId: to, updatedAt: env.ctx.clock.iso() })
      .where(eq(reminder.id, r.id))
      .run();
    return { type: REMINDER_TYPE, id: r.id, before: r, after: getReminder(env.tx, cid, r.id) };
  });
}
