// DM `note.history` (FR-NOTE-17) with the DM's notification views (FR-NOTE-19).
import { notificationsWindow } from "@ui/features/notifications/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { dmNotificationViews } from "../../notification-views";

export const notificationsHistoryWindow = defineWindow({
  ...notificationsWindow(dmNotificationViews),
  // DM right edge below `cbt.initiative` (map-first, #162; protocol §24); no room there
  // (1280×720) → the left edge, never over Initiative or mid-map.
  defaultSize: { w: 360, h: 320 },
  defaultPosition: { anchor: "bottom-right" },
});
