// Notification kind `damage-card` (protocol §23): created by `cbt.attack` via `notify`, resolved
// by `cbt.applyCard`, reopened by `cbt.undo`; never by `note.resolve` (#136). Resolution
// `{targets […]}` (1–20) is over notifications' 256 B default: the kind declares 8 KB (#157).
// Payload: a crit card with non-ASCII names passes the 1 KB default: 4 KB (#163).
import {
  DAMAGE_CARD_KIND,
  DAMAGE_CARD_RESOLUTION_MAX_BYTES,
  DamageCardPayload,
  DamageCardTargetsResolution,
} from "@shared/combat-tracker/schemas";
import { defineNotificationKind } from "../notifications/kind";

/** Per-kind payload cap (FR-NOTE-03, #163): ASCII worst ≈ 950 B; 3-byte names ≈ 1.3 KB. */
export const DAMAGE_CARD_PAYLOAD_MAX_BYTES = 4096;

export const damageCardKind = defineNotificationKind({
  kind: DAMAGE_CARD_KIND,
  ownerSpec: "combat-tracker",
  payload: DamageCardPayload,
  payloadMaxBytes: DAMAGE_CARD_PAYLOAD_MAX_BYTES,
  resolution: DamageCardTargetsResolution,
  resolutionMaxBytes: DAMAGE_CARD_RESOLUTION_MAX_BYTES,
  genericResolve: false,
});
