// Record type `notification` (FR-NOTE-01/06/12, protocol §20): campaign scope, full or hidden,
// windowed snapshot = every pending row + the newest 100 closed rows (ADR-0029).
import {
  NOTIFICATION_WINDOW,
  NotificationRecord,
  notificationVisibleTo,
} from "@shared/notifications/schemas";
import { asc, eq } from "drizzle-orm";
import { notification } from "../../db/schema";
import type { Logger } from "../../log";
import { defineRecordType } from "../../ws/records";
import { NOTIFICATION_TYPE, toNotificationRecord } from "./helpers";

/** NOTE §12: more pending rows than this in a snapshot → server warning. */
export const PENDING_WARN = 100;

export function notificationRecordType(log: Logger) {
  return defineRecordType<NotificationRecord>({
    type: NOTIFICATION_TYPE,
    scope: "campaign",
    schema: NotificationRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    visibility: (r, v) =>
      notificationVisibleTo(r, { role: v.role, playerId: v.playerId }) ? "full" : "hidden",
    // The whole log of the campaign by row seq; the registry cuts the window.
    snapshot: ({ db }, v) => {
      const rows = db
        .select()
        .from(notification)
        .where(eq(notification.campaignId, v.campaignId))
        .orderBy(asc(notification.seq))
        .all()
        .map(toNotificationRecord);
      const pending = rows.reduce((n, r) => n + (r.state === "pending" ? 1 : 0), 0);
      if (pending > PENDING_WARN) {
        log.warn(`notification snapshot: ${pending} pending in campaign ${v.campaignId}`);
      }
      return rows;
    },
    window: { orderBy: "seq", size: NOTIFICATION_WINDOW, pin: (r) => r.state === "pending" },
  });
}
