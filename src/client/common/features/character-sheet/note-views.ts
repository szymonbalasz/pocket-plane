// G8 notification views (FR-CHARX-45/46, FR-NOTE-19). `charx-approved`: both clients (the owner,
// the DM's history). `charx-draft`: DM only; "Review" opens `char.sheet` on the draft, no intent
// (the card stays pending until Approve or Dismiss).
import {
  CHARX_APPROVED_KIND,
  CHARX_DRAFT_KIND,
  CharxNotePayload,
} from "@shared/character-sheet/notes";
import { UserCheckIcon, UserPlusIcon } from "lucide-react";
import { defineNotificationView } from "../notifications/views";
import { openSheetFor } from "./selection";
import { CHAR_SHEET_KIND } from "./window";

export const charxDraftView = defineNotificationView({
  kind: CHARX_DRAFT_KIND,
  icon: UserPlusIcon,
  onAction(n, ctx) {
    const p = CharxNotePayload.safeParse(n.payload);
    if (!p.success) return;
    openSheetFor(p.data.characterId, "character");
    ctx.openWindow(CHAR_SHEET_KIND);
  },
});

export const charxApprovedView = defineNotificationView({
  kind: CHARX_APPROVED_KIND,
  icon: UserCheckIcon,
});
