// DM notification views (FR-NOTE-19, protocol §26). APPEND-ONLY (AGENTS §9.9): a kind owner adds
// one import and one line in the list; nothing else changes here.
import { charxApprovedView, charxDraftView } from "@ui/features/character-sheet/note-views";
import { concentrationView } from "@ui/features/combat-extras/concentration";
import { rollRequestDmView } from "@ui/features/dice-extras/PromptViews";
import { modTriggerView } from "@ui/features/effect-modifiers/note-view";
import { testNotificationView } from "@ui/features/notifications/test-view";
import { createNotificationViews, type NotificationView } from "@ui/features/notifications/views";
import { handoutSharedView } from "@ui/features/party-board/note-view";
import { lootReceivedView } from "@ui/features/party-loot/note-view";
import { statsAwardsView } from "@ui/features/stats/note-view";
import { dmDamageCardView } from "./features/combat-tracker/card-view";
import { dmSummonCardView } from "./features/combat-tracker/summon-card-view";

const views: NotificationView[] = [
  testNotificationView, // test (notifications, FR-NOTE-22), test mode
  dmDamageCardView, // damage-card (combat-tracker, FR-CBT-30)
  lootReceivedView, // loot-received (party-loot, FR-LOOT-14)
  concentrationView, // cbtx-concentration (combat-extras, FR-CBTX-37)
  charxDraftView, // charx-draft (character-sheet-full, FR-CHARX-45)
  charxApprovedView, // charx-approved (character-sheet-full, FR-CHARX-46)
  handoutSharedView, // handout-shared (party-board, FR-PARTY-06)
  modTriggerView, // mod-trigger (effect-modifiers, FR-MOD-44)
  dmSummonCardView, // cbt-summon-concentration (combat-tracker, FR-CBT-120)
  statsAwardsView, // stats-awards (stats, FR-NOTE-48)
  rollRequestDmView, // roll-request (dice-extras, FR-NOTE-61)
];

export const dmNotificationViews = createNotificationViews(views);
