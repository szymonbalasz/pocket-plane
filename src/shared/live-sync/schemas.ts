// live-sync record shapes (SYNC §8) and test-mode probe intents (SYNC §9).
import { z } from "zod";

/** DM-only, in memory (FR-SYNC-23). `id` = playerId (every wire record has an `id`). */
export const PresenceRecord = z.object({
  id: z.string(),
  playerId: z.string(),
  campaignId: z.string(),
  online: z.boolean(),
});
export type PresenceRecord = z.infer<typeof PresenceRecord>;

/** Test mode only (FR-SYNC-27). */
export const ProbeRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  text: z.string(),
  hidden: z.boolean(),
  ownerPlayerId: z.string().nullable(),
});
export type ProbeRecord = z.infer<typeof ProbeRecord>;

const ProbeText = z.string().max(500);

export const ProbeSetInput = z.object({
  id: z.string().min(1).max(64).optional(),
  text: ProbeText,
  hidden: z.boolean(),
  ownerPlayerId: z.string().min(1).max(64).nullable().optional(),
});
export type ProbeSetInput = z.infer<typeof ProbeSetInput>;

export const ProbeEditInput = z.object({ id: z.string().min(1).max(64), text: ProbeText });
export type ProbeEditInput = z.infer<typeof ProbeEditInput>;

/** Player sees a probe iff `!hidden && (owner == null || owner == me)` (SYNC §8). */
export function probeVisibleTo(p: ProbeRecord, playerId: string | null): boolean {
  return !p.hidden && (p.ownerPlayerId === null || p.ownerPlayerId === playerId);
}
