// Player `note.history` (FR-NOTE-17) with the player's notification views (FR-NOTE-19).
import { notificationsWindow } from "@ui/features/notifications/window";
import { playerNotificationViews } from "../../notification-views";

export const notificationsHistoryWindow = notificationsWindow(playerNotificationViews);
