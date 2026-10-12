// Notification kind `damage-card` (protocol §23): created by `cbt.attack` via `notify`, resolved
// by `cbt.applyCard`, reopened by `cbt.undo`; never by `note.resolve` (#136).
import {
  DAMAGE_CARD_KIND,
  DamageCardPayload,
  DamageCardResolution,
} from "@shared/combat-tracker/schemas";
import { defineNotificationKind } from "../notifications/kind";

export const damageCardKind = defineNotificationKind({
  kind: DAMAGE_CARD_KIND,
  ownerSpec: "combat-tracker",
  payload: DamageCardPayload,
  resolution: DamageCardResolution,
  genericResolve: false,
});
