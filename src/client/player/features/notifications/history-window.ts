// Player `note.history` (FR-NOTE-17) with the player's notification views (FR-NOTE-19). Geometry
// is the shared def's (360×480, FR-NOTE-31): no per-client size override, placement per #162.
import { notificationsWindow } from "@ui/features/notifications/window";
import { playerNotificationViews } from "../../notification-views";

export const notificationsHistoryWindow = notificationsWindow(playerNotificationViews);
