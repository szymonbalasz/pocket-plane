// Notification kind `damage-card` (protocol §23): created by `cbt.attack` via `notify`, resolved
// by `cbt.applyCard`, reopened by `cbt.undo`; never by `note.resolve` (#136). Resolution
// `{targets […]}` (1–20) is over notifications' 256 B default: the kind declares 8 KB (#157).
import {
  DAMAGE_CARD_KIND,
  DAMAGE_CARD_RESOLUTION_MAX_BYTES,
  DamageCardPayload,
  DamageCardTargetsResolution,
} from "@shared/combat-tracker/schemas";
import { defineNotificationKind } from "../notifications/kind";

export const damageCardKind = defineNotificationKind({
  kind: DAMAGE_CARD_KIND,
  ownerSpec: "combat-tracker",
  payload: DamageCardPayload,
  resolution: DamageCardTargetsResolution,
  resolutionMaxBytes: DAMAGE_CARD_RESOLUTION_MAX_BYTES,
  genericResolve: false,
});
