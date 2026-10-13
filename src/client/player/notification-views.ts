// Player notification views (FR-NOTE-19, protocol §26). APPEND-ONLY (AGENTS §9.9): a kind owner
// adds one import and one line in the list; nothing else changes here.
import { testNotificationView } from "@ui/features/notifications/test-view";
import { createNotificationViews, type NotificationView } from "@ui/features/notifications/views";
import { playerDamageCardView } from "./features/combat-tracker/card-view";

const views: NotificationView[] = [
  testNotificationView, // test (notifications, FR-NOTE-22), test mode
  playerDamageCardView, // damage-card (combat-tracker, FR-CBT-30)
];

export const playerNotificationViews = createNotificationViews(views);
