// G8 cues (FR-CHARX-45/46): `char.create` / `char.approve` call these in their transaction, after
// their own event (protocol §22 order).
import {
  approvedText,
  CHARX_APPROVED_KIND,
  CHARX_DRAFT_KIND,
  CHARX_REVIEW_LABEL,
  CharxNotePayload,
  draftCardText,
} from "@shared/character-sheet/notes";
import { and, asc, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { notification, player } from "../../db/schema";
import { notify, resolveNotification } from "../notifications/helpers";

function playerName(env: CommandEnv, id: string): string {
  const row = env.tx.select({ name: player.name }).from(player).where(eq(player.id, id)).get();
  return row?.name ?? "A player";
}

/** FR-CHARX-45: a player's new draft → pending card for the DM ("Review"). */
export function notifyDraft(env: CommandEnv, characterId: string, name: string, ownerId: string) {
  notify(env, {
    kind: CHARX_DRAFT_KIND,
    audience: "dm",
    text: draftCardText(playerName(env, ownerId), name),
    payload: { characterId },
    action: { label: CHARX_REVIEW_LABEL, role: "dm" },
  });
}

/** Pending `charx-draft` cards of this character (actor's campaign), seq order. */
function pendingDraftCards(env: CommandEnv, characterId: string): string[] {
  return env.tx
    .select({ id: notification.id, payload: notification.payload })
    .from(notification)
    .where(
      and(
        eq(notification.campaignId, env.actor.campaignId ?? ""),
        eq(notification.kind, CHARX_DRAFT_KIND),
        eq(notification.state, "pending"),
      ),
    )
    .orderBy(asc(notification.seq))
    .all()
    .filter((n) => CharxNotePayload.safeParse(n.payload).data?.characterId === characterId)
    .map((n) => n.id);
}

/**
 * FR-CHARX-45/46: a draft turned ready → its pending `charx-draft` card(s) resolved
 * `{outcome: "approved"}`, then the owner's `charx-approved` info.
 */
export function notifyApproved(
  env: CommandEnv,
  characterId: string,
  name: string,
  ownerId: string | null,
) {
  for (const id of pendingDraftCards(env, characterId)) {
    resolveNotification(env, id, { outcome: "approved" });
  }
  if (!ownerId) return;
  notify(env, {
    kind: CHARX_APPROVED_KIND,
    audience: "player",
    audiencePlayerId: ownerId,
    text: approvedText(name),
    payload: { characterId },
  });
}
