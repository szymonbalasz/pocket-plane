// DM `note.history` (FR-NOTE-17) with the DM's notification views (FR-NOTE-19).
import { notificationsWindow } from "@ui/features/notifications/window";
import { dmNotificationViews } from "../../notification-views";

export const notificationsHistoryWindow = notificationsWindow(dmNotificationViews);
