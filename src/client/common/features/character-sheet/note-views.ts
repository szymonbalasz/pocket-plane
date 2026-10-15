// G8 notification views (FR-CHARX-45/46, FR-NOTE-19). `charx-approved`: both clients (the owner,
// the DM's history). `charx-draft`: DM only; "Review" opens `char.sheet` on the draft, no intent
// (the card stays pending until Approve or Dismiss); its toast closes once the sheet shows the
// draft (P3 glitch 8).
import {
  CHARX_APPROVED_KIND,
  CHARX_DRAFT_KIND,
  CharxNotePayload,
} from "@shared/character-sheet/notes";
import type { NotificationRecord } from "@shared/notifications/schemas";
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
    // P3 glitch 8: the sheet now shows the draft; its toast closes (the row stays pending).
    ctx.closeToast();
  },
});

/**
 * P3 glitch 8 (DM): pending `charx-draft` rows whose draft the open `char.sheet` already shows;
 * their toasts close (`hideToast`), the rows stay pending in Notifications and on the bell.
 */
export function draftToastsShown(
  notes: readonly Pick<NotificationRecord, "id" | "kind" | "state" | "payload">[],
  shownId: string | null,
): string[] {
  if (!shownId) return [];
  return notes.flatMap((n) => {
    if (n.kind !== CHARX_DRAFT_KIND || n.state !== "pending") return [];
    const p = CharxNotePayload.safeParse(n.payload);
    return p.success && p.data.characterId === shownId ? [n.id] : [];
  });
}

export const charxApprovedView = defineNotificationView({
  kind: CHARX_APPROVED_KIND,
  icon: UserCheckIcon,
});
