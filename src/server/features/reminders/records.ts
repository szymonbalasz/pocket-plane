// Record type `reminder` (FR-REM-01, -13): campaign scope, lazy `"all"` (ADR-0045, ADR-0065):
// never in a snapshot, loaded with `sync.load`. DM full; a player gets party reminders and their
// own characters' ones, redacted (no `seq`, `updatedAt`, DM keys), never hidden or linked-hidden.
import {
  REMINDER_TYPE,
  ReminderRecord,
  redactReminder,
  reminderVisibility,
} from "@shared/reminders/schemas";
import { defineRecordType } from "../../ws/records";
import { listReminders } from "./rows";

export const reminderType = defineRecordType<ReminderRecord>({
  type: REMINDER_TYPE,
  scope: "campaign",
  lazy: "all",
  schema: ReminderRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: (r, v) => reminderVisibility(r, v),
  redact: (r) => redactReminder(r),
  snapshot: ({ db }, v) => listReminders(db, v.campaignId),
});
