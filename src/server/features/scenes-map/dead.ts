// FR-MAP-151: a token marked dead keeps the red X outside combat. Combat's End calls `markDead`
// with the tokens of monsters left at 0 HP, so the X it drew stays; the token menu clears it.
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { and, eq, inArray } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { readToken, toTokenRecord } from "./rows";

/** Marks the existing, not yet dead tokens dead; their upserts for the caller's event. */
export function markDead(env: Pick<CommandEnv, "tx" | "ctx">, tokenIds: string[]): RecordChange[] {
  if (tokenIds.length === 0) return [];
  const rows = env.tx
    .select()
    .from(token)
    .where(and(inArray(token.id, tokenIds), eq(token.dead, false)))
    .all()
    .map(toTokenRecord);
  const now = env.ctx.clock.iso();
  return rows.map((before) => {
    env.tx.update(token).set({ dead: true, updatedAt: now }).where(eq(token.id, before.id)).run();
    return { type: TOKEN_TYPE, id: before.id, before, after: readToken(env.tx, before.id) };
  });
}
