// Server notification kind registry (FR-NOTE-03, protocol §23/§26). APPEND-ONLY (AGENTS §9.9):
// a kind owner adds one import and one line in the list; nothing else changes here. Each line
// names the kind's toast class (FR-NOTE-52: pending → card, else info), in its def or here.
import { charxApprovedKind, charxDraftKind } from "../character-sheet/draft-kinds";
import { concentrationCardKind } from "../combat-extras/card-kind";
import { damageCardKind } from "../combat-tracker/card-kind";
import { summonCardKind } from "../combat-tracker/summon-card-kind";
import { rollRequestKind } from "../dice-extras/request-kind";
import { modTriggerKind } from "../effect-modifiers/reminders";
import { handoutSharedKind } from "../party-board/kind";
import { lootReceivedKind } from "../party-loot/kind";
import { statsAwardsKind, statsFightSummaryKind } from "../stats/kind";
import type { RegisteredKindDef } from "./kind";
import { testKind } from "./test-kind";

export const notificationKinds: readonly RegisteredKindDef[] = [
  { ...testKind, toastClass: "info" }, // test (notifications, FR-NOTE-22), test mode only
  { ...damageCardKind, toastClass: "card" }, // damage-card (combat-tracker, FR-CBT-18)
  { ...lootReceivedKind, toastClass: "info" }, // loot-received (party-loot, FR-LOOT-13)
  { ...concentrationCardKind, toastClass: "card" }, // cbtx-concentration (combat-extras, FR-CBTX-17)
  { ...charxDraftKind, toastClass: "card" }, // charx-draft (character-sheet-full, FR-CHARX-45)
  { ...charxApprovedKind, toastClass: "info" }, // charx-approved (character-sheet-full, FR-CHARX-46)
  { ...modTriggerKind, toastClass: "info" }, // mod-trigger (effect-modifiers, FR-MOD-44)
  { ...handoutSharedKind, toastClass: "info" }, // handout-shared (party-board, FR-PARTY-06)
  { ...summonCardKind, toastClass: "card" }, // cbt-summon-concentration (combat-tracker, FR-CBT-120)
  { ...statsAwardsKind, toastClass: "info" }, // stats-awards (stats, FR-NOTE-48)
  { ...rollRequestKind, toastClass: "card" }, // roll-request (dice-extras, FR-NOTE-58)
  { ...statsFightSummaryKind, toastClass: "info" }, // stats-fight-summary (stats, FR-NOTE-68)
];
