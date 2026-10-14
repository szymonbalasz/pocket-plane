// DM notification views (FR-NOTE-19, protocol §26). APPEND-ONLY (AGENTS §9.9): a kind owner adds
// one import and one line in the list; nothing else changes here.
import { concentrationView } from "@ui/features/combat-extras/concentration";
import { testNotificationView } from "@ui/features/notifications/test-view";
import { createNotificationViews, type NotificationView } from "@ui/features/notifications/views";
import { lootReceivedView } from "@ui/features/party-loot/note-view";
import { dmDamageCardView } from "./features/combat-tracker/card-view";

const views: NotificationView[] = [
  testNotificationView, // test (notifications, FR-NOTE-22), test mode
  dmDamageCardView, // damage-card (combat-tracker, FR-CBT-30)
  lootReceivedView, // loot-received (party-loot, FR-LOOT-14)
  concentrationView, // cbtx-concentration (combat-extras, FR-CBTX-37)
];

export const dmNotificationViews = createNotificationViews(views);
