// Server notification kind registry (FR-NOTE-03, protocol §23/§26). APPEND-ONLY (AGENTS §9.9):
// a kind owner adds one import and one line in the list; nothing else changes here.
import { charxApprovedKind, charxDraftKind } from "../character-sheet/draft-kinds";
import { concentrationCardKind } from "../combat-extras/card-kind";
import { damageCardKind } from "../combat-tracker/card-kind";
import { modTriggerKind } from "../effect-modifiers/reminders";
import { lootReceivedKind } from "../party-loot/kind";
import type { NotificationKindDef } from "./kind";
import { testKind } from "./test-kind";

export const notificationKinds: readonly NotificationKindDef[] = [
  testKind, // test (notifications, FR-NOTE-22), test mode only
  damageCardKind, // damage-card (combat-tracker, FR-CBT-18)
  lootReceivedKind, // loot-received (party-loot, FR-LOOT-13)
  concentrationCardKind, // cbtx-concentration (combat-extras, FR-CBTX-17)
  charxDraftKind, // charx-draft (character-sheet-full, FR-CHARX-45)
  charxApprovedKind, // charx-approved (character-sheet-full, FR-CHARX-46)
  modTriggerKind, // mod-trigger (effect-modifiers, FR-MOD-44)
];
