// Event log: append-only, written in the command's transaction (FR-SYNC-16).
import { asc, eq, isNull } from "drizzle-orm";
import type { CommandContext } from "../commands/context";
import type { Db, Tx } from "../db/client";
import { eventLog } from "../db/schema";
import type { DispatchMeta, DomainEvent } from "./types";

export function appendEventLog(
  tx: Tx,
  ctx: CommandContext,
  event: DomainEvent,
  meta: Omit<DispatchMeta, "originConnId">,
): void {
  tx.insert(eventLog)
    .values({
      id: ctx.ids.next(),
      campaignId: event.campaignId,
      type: event.type,
      at: ctx.clock.iso(),
      payload: event.payload,
      actorRole: meta.actor.role,
      actorPlayerId: meta.actor.playerId,
      intentId: meta.intentId,
    })
    .run();
}

/** Time-ordered: timestamp, then insertion order (ADR-0022). */
export function readEventLog(db: Db | Tx, campaignId?: string | null) {
  const q = db.select().from(eventLog);
  const filtered =
    campaignId === undefined
      ? q
      : q.where(
          campaignId === null ? isNull(eventLog.campaignId) : eq(eventLog.campaignId, campaignId),
        );
  return filtered.orderBy(asc(eventLog.at), asc(eventLog.seq)).all();
}
