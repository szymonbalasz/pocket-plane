// Domain events of notifications (NOTE §9, protocol §22). All logged; none undoable.
// Shared definitions (fix/combat-core); emitted by the helpers via `env.emit`, after the
// owner's event (CON-40).
import { z } from "zod";
import { defineEvent } from "./types";

/** `notify`: changes = `notification` upsert (before null). */
export const NotificationCreated = defineEvent({
  type: "NotificationCreated",
  payload: z
    .object({
      notificationId: z.string(),
      kind: z.string(),
      audience: z.enum(["dm", "player", "all"]),
      audiencePlayerId: z.string().nullable(),
      hasAction: z.boolean(),
    })
    .strict(),
  logged: true,
  undoable: false,
});

const NotificationRef = z.object({ notificationId: z.string(), kind: z.string() }).strict();

/** `resolveNotification` (`cbt.applyCard`, `note.resolve`). */
export const NotificationResolved = defineEvent({
  type: "NotificationResolved",
  payload: NotificationRef,
  logged: true,
  undoable: false,
});

/** `note.dismiss`. */
export const NotificationDismissed = defineEvent({
  type: "NotificationDismissed",
  payload: NotificationRef,
  logged: true,
  undoable: false,
});

/** `reopenNotification` (`cbt.undo`), after `CombatEntryUndone`. */
export const NotificationReopened = defineEvent({
  type: "NotificationReopened",
  payload: NotificationRef,
  logged: true,
  undoable: false,
});
