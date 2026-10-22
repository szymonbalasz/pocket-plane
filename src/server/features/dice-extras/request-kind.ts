// Notification kind `roll-request` (FR-NOTE-58, ADR-0061): one pending prompt per target, audience
// `player` = the PC's owner, action "Roll" owned by that player. Toast class **card** (FR-NOTE-52,
// seams S13). Made by `dicex.request`, resolved only by dice-extras' commands (answer, decline,
// close / roll for missing, owner change): never `note.resolve`, no end rule (FR-NOTE-62).
import {
  ROLL_REQUEST_KIND,
  RollRequestPromptPayload,
  RollRequestPromptResolution,
} from "@shared/dice-extras/requests";
import { defineNotificationKind } from "../notifications/kind";

export const rollRequestKind = defineNotificationKind({
  kind: ROLL_REQUEST_KIND,
  ownerSpec: "dice-extras",
  payload: RollRequestPromptPayload,
  resolution: RollRequestPromptResolution,
  genericResolve: false,
});
