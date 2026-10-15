// DM Initiative "Pending (n)" (FR-CBT-79, G9): every pending notification whose DM view links it
// to the started encounter (FR-NOTE-29 `encounterIdOf`): damage cards and combat-extras'
// concentration cards. Pure, DOM-free (bun test).
import { DAMAGE_CARD_KIND } from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { encounterIdOfView, type NotificationViews } from "@ui/features/notifications/views";

/** Pending rows linked to `encounterId` by their kind's view, oldest first. */
export function pendingForEncounter(
  notes: readonly NotificationRecord[],
  encounterId: string | null | undefined,
  views: NotificationViews,
): NotificationRecord[] {
  if (!encounterId) return [];
  return notes
    .filter(
      (n) =>
        n.state === "pending" && encounterIdOfView(views.get(n.kind), n.payload) === encounterId,
    )
    .sort((a, b) => a.seq - b.seq);
}

export const isDamageCard = (n: Pick<NotificationRecord, "kind">) => n.kind === DAMAGE_CARD_KIND;

/**
 * Pending row text: a damage card's text; another kind owned by a player reads "Waiting for
 * Mira: concentration save DC 10 (Bless)" (its text starts with the creature's name); DM-owned
 * rows read as their toast.
 */
export function pendingRowText(n: Pick<NotificationRecord, "kind" | "text" | "actionRole">) {
  return !isDamageCard(n) && n.actionRole === "player" ? `Waiting for ${n.text}` : n.text;
}
