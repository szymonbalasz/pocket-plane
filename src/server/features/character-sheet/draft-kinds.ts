// G8 notification kinds (FR-CHARX-45/46, protocol §23). Created / resolved by `./draft-notes.ts`
// in `char.create` / `char.approve`; never by `note.resolve`.
import {
  CHARX_APPROVED_KIND,
  CHARX_DRAFT_KIND,
  CharxDraftResolution,
  CharxNotePayload,
} from "@shared/character-sheet/notes";
import { defineNotificationKind } from "../notifications/kind";

/** `charx-draft`: pending for the DM; closed by `char.approve` or the DM's Dismiss. */
export const charxDraftKind = defineNotificationKind({
  kind: CHARX_DRAFT_KIND,
  ownerSpec: "character-sheet-full",
  payload: CharxNotePayload,
  resolution: CharxDraftResolution,
  genericResolve: false,
});

/** `charx-approved`: info to the owner. */
export const charxApprovedKind = defineNotificationKind({
  kind: CHARX_APPROVED_KIND,
  ownerSpec: "character-sheet-full",
  payload: CharxNotePayload,
  genericResolve: false,
});
