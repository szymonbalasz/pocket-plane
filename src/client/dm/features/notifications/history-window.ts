// DM `note.history` (FR-NOTE-17) with the DM's notification views (FR-NOTE-19).
import { notificationsWindow } from "@ui/features/notifications/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { dmNotificationViews } from "../../notification-views";

export const notificationsHistoryWindow = defineWindow({
  ...notificationsWindow(dmNotificationViews),
  // DM top edge, left of `cbt.initiative` (protocol §24); never over it.
  defaultSize: { w: 360, h: 320 },
  defaultPosition: { anchor: "top-right", dx: 412 },
});
