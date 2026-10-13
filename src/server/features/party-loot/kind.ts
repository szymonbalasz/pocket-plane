// Notification kind `loot-received` (FR-LOOT-13): info to all, no action, created only by
// `partyLoot.add`; never by `note.resolve`.
import { LOOT_RECEIVED_KIND, LootReceivedPayload } from "@shared/party-loot/schemas";
import { defineNotificationKind } from "../notifications/kind";

export const lootReceivedKind = defineNotificationKind({
  kind: LOOT_RECEIVED_KIND,
  ownerSpec: "party-loot",
  payload: LootReceivedPayload,
  genericResolve: false,
});
