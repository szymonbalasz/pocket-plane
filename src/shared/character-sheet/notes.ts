// G8 notification kinds of character-sheet-full (FR-CHARX-45/46, protocol §23): shared by the
// server kinds and both clients' views.
import { TEXT_MAX } from "@shared/notifications/schemas";
import { z } from "zod";

/** FR-CHARX-45: pending card for the DM, "Review" (owner DM); resolved by `char.approve`. */
export const CHARX_DRAFT_KIND = "charx-draft";
/** FR-CHARX-46: info to the owner when the DM approves their draft. */
export const CHARX_APPROVED_KIND = "charx-approved";

export const CHARX_REVIEW_LABEL = "Review";

export const CharxNotePayload = z.strictObject({ characterId: z.string().min(1).max(64) });
export type CharxNotePayload = z.infer<typeof CharxNotePayload>;

/** `char.approve` closes the draft card with this resolution. */
export const CharxDraftResolution = z.strictObject({ outcome: z.literal("approved") });
export type CharxDraftResolution = z.infer<typeof CharxDraftResolution>;

const cut = (s: string) => (s.length > TEXT_MAX ? `${s.slice(0, TEXT_MAX - 1)}…` : s);

/** "‹player› made a character: ‹name›. Awaiting your approval" (create-time words). */
export const draftCardText = (playerName: string, characterName: string) =>
  cut(`${playerName} made a character: ${characterName}. Awaiting your approval`);

/** "‹name› was approved by the DM: ready to play". */
export const approvedText = (characterName: string) =>
  cut(`${characterName} was approved by the DM: ready to play`);
