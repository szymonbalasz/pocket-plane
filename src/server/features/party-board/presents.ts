// `handout-present` writes shared by the present commands and the share / delete amendments
// (FR-PARTY-32, -33, -35). Each returns the record changes; the caller emits them in its event.
import { HandoutPresented } from "@shared/events/party-board";
import type { SharedWith } from "@shared/party-board/schemas";
import { HANDOUT_PRESENT_TYPE, type HandoutPresentRecord } from "@shared/party-board/schemas";
import { sharedWithPlayer } from "@shared/party-board/visibility";
import { and, eq, inArray } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { handoutPresent } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { presentsOfHandout, toPresentRecord } from "./rows";

/** Deletes `rows`; one delete change each. */
export function deletePresents(
  env: CommandEnv,
  rows: readonly HandoutPresentRecord[],
): RecordChange[] {
  if (rows.length === 0) return [];
  env.tx
    .delete(handoutPresent)
    .where(
      inArray(
        handoutPresent.id,
        rows.map((r) => r.id),
      ),
    )
    .run();
  return rows.map((r) => ({ type: HANDOUT_PRESENT_TYPE, id: r.id, before: r, after: null }));
}

/**
 * FR-PARTY-35: the rows of `handoutId` whose player can't see it under `sharedWith` (share losers;
 * every row when `sharedWith` is null, a delete), deleted.
 */
export function closeLostPresents(
  env: CommandEnv,
  handoutId: string,
  sharedWith: SharedWith | null,
): RecordChange[] {
  const lost = presentsOfHandout(env.tx, handoutId).filter(
    (r) => sharedWith === null || !sharedWithPlayer(sharedWith, r.playerId),
  );
  return deletePresents(env, lost);
}

/**
 * FR-PARTY-32 per target (callers checked that each can see the handout): delete their current
 * row (any handout), insert a new one (id `ctx.ids`, `presentedAt` now). Emits
 * `HandoutPresented`. Returns the new ids in target order.
 */
export function presentTo(
  env: CommandEnv,
  campaignId: string,
  handoutId: string,
  playerIds: readonly string[],
): string[] {
  const changes: RecordChange[] = [];
  const presentIds: string[] = [];
  const now = env.ctx.clock.iso();
  for (const playerId of playerIds) {
    const old = env.tx
      .select()
      .from(handoutPresent)
      .where(and(eq(handoutPresent.campaignId, campaignId), eq(handoutPresent.playerId, playerId)))
      .get();
    if (old) changes.push(...deletePresents(env, [toPresentRecord(old)]));
    const row: HandoutPresentRecord = {
      id: env.ctx.ids.next(),
      campaignId,
      handoutId,
      playerId,
      presentedAt: now,
    };
    env.tx.insert(handoutPresent).values(row).run();
    changes.push({ type: HANDOUT_PRESENT_TYPE, id: row.id, before: null, after: row });
    presentIds.push(row.id);
  }
  env.emit({
    type: HandoutPresented.type,
    campaignId,
    payload: { handoutId, playerIds: [...playerIds] },
    changes,
  });
  return presentIds;
}
