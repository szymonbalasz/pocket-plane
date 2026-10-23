// Notification kind `session-recap` (FR-RECAP-23): audience `all`, no action (state `info`: a
// toast + a history row), payload player-safe `{fromN, toN, from, to, label, note?, omit}` ≤ 2 KB;
// made only by `recap.share`. No `endRule`: a recap outlives fights. Toast class info (seams S6).
import {
  RECAP_PAYLOAD_MAX_BYTES,
  SESSION_RECAP_KIND,
  SessionRecapPayload,
} from "@shared/session-recap/schemas";
import { defineNotificationKind } from "../notifications/kind";

export const sessionRecapKind = defineNotificationKind({
  kind: SESSION_RECAP_KIND,
  ownerSpec: "session-recap",
  payload: SessionRecapPayload,
  payloadMaxBytes: RECAP_PAYLOAD_MAX_BYTES,
  genericResolve: false,
});
