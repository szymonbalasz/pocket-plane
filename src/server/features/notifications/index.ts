// notifications feature (NOTE): record type, intents; helpers for kind owners in `./helpers`.
import type { Feature } from "../../services";
import { noteDismiss, noteResolve, noteTestSend } from "./commands";
import { notificationRecordType } from "./records";

export {
  dismissForEncounter,
  type NotifyInput,
  notify,
  reopenNotification,
  resolveNotification,
} from "./helpers";
export { defineNotificationKind, type NotificationKindDef } from "./kind";

export const notifications: Feature = {
  name: "notifications",
  register(r) {
    r.recordType(notificationRecordType(r.services.log));
    r.command(noteDismiss, { intent: true });
    r.command(noteResolve, { intent: true });
    // Kind `test` is only ever created through this intent (FR-NOTE-22).
    if (r.services.config.testMode) r.command(noteTestSend, { intent: true });
  },
};
