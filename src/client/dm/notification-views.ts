// DM notification views (FR-NOTE-19, protocol §26). APPEND-ONLY (AGENTS §9.9): a kind owner adds
// one import and one line in the list; nothing else changes here.
import { testNotificationView } from "@ui/features/notifications/test-view";
import { createNotificationViews, type NotificationView } from "@ui/features/notifications/views";

const views: NotificationView[] = [
  testNotificationView, // test (notifications, FR-NOTE-22), test mode
];

export const dmNotificationViews = createNotificationViews(views);
