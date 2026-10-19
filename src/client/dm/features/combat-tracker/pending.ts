// DM Initiative "Pending (n)" (FR-CBT-79, G9): every pending notification whose DM view links it
// to the started encounter (FR-NOTE-29 `encounterIdOf`): damage cards and combat-extras'
// concentration cards. Pure, DOM-free (bun test).
import {
  DAMAGE_CARD_KIND,
  DamageCardPayload,
  type HitRulingRecord,
} from "@shared/combat-tracker/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { encounterIdOfView, type NotificationViews } from "@ui/features/notifications/views";

/**
 * Pending rows linked to `encounterId` by their kind's view: linked actions (concentration, a
 * player's wait) before damage cards, so FR-CBT-77's 3-row cap never scrolls them away (sim-6
 * glitch 1); oldest first within each.
 */
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
    .sort((a, b) => Number(isDamageCard(a)) - Number(isDamageCard(b)) || a.seq - b.seq);
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

/**
 * FR-CBT-89 (sprint 5): a damage card's Pending row and its popup step. A ruled card reads "Mira:
 * hit Goblin — waiting for damage" (no damage yet) or "… — damage ready"; any other card its
 * text, in the to-hit step.
 */
export function damageCardRow(
  n: Pick<NotificationRecord, "text" | "payload">,
  ruling: HitRulingRecord | null | undefined,
  nameOf: (combatantId: string) => string | undefined,
): { text: string; step: "to-hit" | "damage" } {
  const p = DamageCardPayload.safeParse(n.payload);
  if (!ruling || !p.success) return { text: n.text, step: "to-hit" };
  const hits = ruling.targets.filter((t) => t.hit).map((t) => nameOf(t.targetId) ?? "?");
  const state = p.data.damage === null ? "waiting for damage" : "damage ready";
  return { text: `${p.data.attackerName}: hit ${hits.join(", ")} — ${state}`, step: "damage" };
}
