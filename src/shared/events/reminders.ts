// Domain events of reminders (REM §9). All logged; none undoable. Payloads reach clients only as
// filtered record changes: the `reminder` visibility fn decides per viewer (FR-REM-13).
import { z } from "zod";
import { defineEvent } from "./types";

const Id = z.string().min(1).max(64);

/** `rem.save` (FR-REM-07): changes = the `reminder` row. */
export const ReminderSaved = defineEvent({
  type: "ReminderSaved",
  payload: z.strictObject({ reminderId: Id, created: z.boolean() }),
  logged: true,
  undoable: false,
});

/** `rem.delete` (FR-REM-09): changes = `reminder` → null. */
export const ReminderDeleted = defineEvent({
  type: "ReminderDeleted",
  payload: z.strictObject({ reminderIds: z.array(Id).min(1) }),
  logged: true,
  undoable: false,
});
