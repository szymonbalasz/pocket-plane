// DM notification views (FR-NOTE-19, protocol §26). APPEND-ONLY (AGENTS §9.9): a kind owner adds
// one import and one line in the list; nothing else changes here. Each line names the kind's
// toast class (FR-NOTE-52: the server kind's; pending → card, else info).
import { charxApprovedView, charxDraftView } from "@ui/features/character-sheet/note-views";
import { concentrationView } from "@ui/features/combat-extras/concentration";
import { rollRequestDmView } from "@ui/features/dice-extras/PromptViews";
import { modTriggerView } from "@ui/features/effect-modifiers/note-view";
import { testNotificationView } from "@ui/features/notifications/test-view";
import { createNotificationViews, type RegisteredView } from "@ui/features/notifications/views";
import { handoutSharedView } from "@ui/features/party-board/note-view";
import { lootReceivedView } from "@ui/features/party-loot/note-view";
import { statsAwardsView, statsFightSummaryView } from "@ui/features/stats/note-view";
import { dmDamageCardView } from "./features/combat-tracker/card-view";
import { dmSummonCardView } from "./features/combat-tracker/summon-card-view";

const views: RegisteredView[] = [
  { ...testNotificationView, toastClass: "info" }, // test (notifications, FR-NOTE-22), test mode
  { ...dmDamageCardView, toastClass: "card" }, // damage-card (combat-tracker, FR-CBT-30)
  { ...lootReceivedView, toastClass: "info" }, // loot-received (party-loot, FR-LOOT-14)
  { ...concentrationView, toastClass: "card" }, // cbtx-concentration (combat-extras, FR-CBTX-37)
  { ...charxDraftView, toastClass: "card" }, // charx-draft (character-sheet-full, FR-CHARX-45)
  { ...charxApprovedView, toastClass: "info" }, // charx-approved (character-sheet-full, FR-CHARX-46)
  { ...handoutSharedView, toastClass: "info" }, // handout-shared (party-board, FR-PARTY-06)
  { ...modTriggerView, toastClass: "info" }, // mod-trigger (effect-modifiers, FR-MOD-44)
  { ...dmSummonCardView, toastClass: "card" }, // cbt-summon-concentration (combat-tracker, FR-CBT-120)
  { ...statsAwardsView, toastClass: "info" }, // stats-awards (stats, FR-NOTE-48)
  { ...rollRequestDmView, toastClass: "card" }, // roll-request (dice-extras, FR-NOTE-61)
  { ...statsFightSummaryView, toastClass: "info" }, // stats-fight-summary (stats, FR-NOTE-68)
];

export const dmNotificationViews = createNotificationViews(views);
