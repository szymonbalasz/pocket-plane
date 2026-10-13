// Player `note.history` (FR-NOTE-17) with the player's notification views (FR-NOTE-19).
import { notificationsWindow } from "@ui/features/notifications/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { playerNotificationViews } from "../../notification-views";

export const notificationsHistoryWindow = defineWindow({
  ...notificationsWindow(playerNotificationViews),
  // Player: toasts + launcher bell first. Opened: bottom-right below `char.sheet` at 1600×900;
  // where that's taken (1280×720) the next free slot (FR-SHELL-08), never over the sheet.
  defaultSize: { w: 360, h: 300 },
  defaultPosition: { anchor: "bottom-right" },
});
