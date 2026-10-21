// Record type `notification` (FR-NOTE-01/06/12, protocol §20): campaign scope, full or hidden,
// kinds' feature traces stripped while the feature is off (ADR-0058, sprint 7),
// windowed snapshot = every pending row + the newest 100 closed rows
// (ADR-0029), both cut in SQL so build time doesn't grow with history.
import {
  NOTIFICATION_WINDOW,
  NotificationRecord,
  notificationVisibleTo,
} from "@shared/notifications/schemas";
import { and, desc, eq, ne } from "drizzle-orm";
import { notification } from "../../db/schema";
import type { Logger } from "../../log";
import { defineRecordType } from "../../ws/records";
import { NOTIFICATION_TYPE, notificationKindOf, toNotificationRecord } from "./helpers";

/** NOTE §12: more pending rows than this in a snapshot → server warning. */
export const PENDING_WARN = 100;
export function notificationRecordType(log: Logger) {
  return defineRecordType<NotificationRecord>({
    type: NOTIFICATION_TYPE,
    scope: "campaign",
    schema: NotificationRecord,
    idOf: (r) => r.id,
    campaignOf: (r) => r.campaignId,
    // ADR-0058 (sprint 7): a kind's declared traces (gems' maxed dice on damage cards).
    tracesOf: (r) => notificationKindOf(r.kind)?.traces ?? [],
    visibility: (r, v) =>
      notificationVisibleTo(r, { role: v.role, playerId: v.playerId }) ? "full" : "hidden",
    // Every pending row + the newest 100 closed, oldest first. Viewer-independent
    // (cut before the filter, ADR-0029); the registry's cut keeps exactly these rows.
    snapshot: ({ db }, v) => {
      const pending = db
        .select()
        .from(notification)
        .where(and(eq(notification.campaignId, v.campaignId), eq(notification.state, "pending")))
        .all()
        .map(toNotificationRecord)
        // Sorted here, not in SQL: keeps the (campaign, state) index (#163).
        .sort((a, b) => a.seq - b.seq);
      if (pending.length > PENDING_WARN) {
        log.warn(`notification snapshot: ${pending.length} pending in campaign ${v.campaignId}`);
      }
      const closed = db
        .select()
        .from(notification)
        .where(and(eq(notification.campaignId, v.campaignId), ne(notification.state, "pending")))
        .orderBy(desc(notification.seq))
        .limit(NOTIFICATION_WINDOW)
        .all()
        .map(toNotificationRecord);
      return [...pending, ...closed].sort((a, b) => a.seq - b.seq);
    },
    window: { orderBy: "seq", size: NOTIFICATION_WINDOW, pin: (r) => r.state === "pending" },
  });
}
