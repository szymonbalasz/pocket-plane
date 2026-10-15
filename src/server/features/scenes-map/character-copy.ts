// FR-MAP-50: `token.characterId`, a display copy of `definitionId` on character tokens (null on
// monster / NPC tokens) that players may see (FR-MAP-26 as amended, ruling P2b-1).
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import { entity, token } from "../../db/schema";

export const characterIdOf = (def: { id: string; kind: string }): string | null =>
  def.kind === "character" ? def.id : null;

/** Boot backfill for rows from before the column (idempotent, one statement). */
export function backfillCharacterIds(db: Db): void {
  const characters = db.select({ id: entity.id }).from(entity).where(eq(entity.kind, "character"));
  db.update(token)
    .set({ characterId: token.definitionId })
    .where(and(isNull(token.characterId), inArray(token.definitionId, characters)))
    .run();
}
