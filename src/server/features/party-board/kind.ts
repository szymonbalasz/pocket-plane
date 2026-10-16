// Notification kind `handout-shared` (FR-PARTY-06): info, no action, payload `{handoutId}`;
// created only by `party.shareHandout` for the players who gain access; never by `note.resolve`.
import { HANDOUT_SHARED_KIND, HandoutSharedPayload } from "@shared/party-board/schemas";
import { defineNotificationKind } from "../notifications/kind";

export const handoutSharedKind = defineNotificationKind({
  kind: HANDOUT_SHARED_KIND,
  ownerSpec: "party-board",
  payload: HandoutSharedPayload,
  genericResolve: false,
});
