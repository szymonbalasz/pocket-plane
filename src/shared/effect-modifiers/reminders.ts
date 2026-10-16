// Notification kind `mod-trigger` (FR-MOD-44; protocol §23): a rule trigger's turn-start reminder,
// info (no action, no end rule; rows stay in History). Payload is player-safe: the audience is the
// DM (monsters, hidden PCs) or the PC's owner.
import { z } from "zod";
import { TRIGGER_NAME_MAX } from "./trigger-records";

export const MOD_TRIGGER_KIND = "mod-trigger";

export const ModTriggerPayload = z.strictObject({
  triggerName: z.string().min(1).max(TRIGGER_NAME_MAX),
  creatureName: z.string().min(1).max(80),
  encounterId: z.string().min(1).max(64),
  /** The reminder with `{value}` filled in (≤ 120 + the value). */
  text: z.string().min(1).max(160),
});
export type ModTriggerPayload = z.infer<typeof ModTriggerPayload>;
