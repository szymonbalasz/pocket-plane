// reminders (REM): record type `reminder` (lazy `"all"`, ADR-0065), intents `rem.save` /
// `rem.delete`. The owner copy follows the PC through entities' definition-changed hook line
// (`owner-hook.ts`); HOLD commands write `linkHidden` and remove linked rows (`rows.ts`).
import type { Feature } from "../../services";
import { deleteReminder, saveReminder } from "./commands";
import { reminderType } from "./records";

export const reminders: Feature = {
  name: "reminders",
  register(r) {
    r.recordType(reminderType);
    r.command(saveReminder, { intent: true });
    r.command(deleteReminder, { intent: true });
  },
};
