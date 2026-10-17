// FR-ENT-27 fill (ADR-0050, review B7): a token's `creatureType` is token-owned after placement;
// the one exception is an update that gives a definition a type it didn't have (absent → present:
// the SRD Update, a form edit). Its tokens whose `creatureType` is null get that type, inside the
// update's transaction (definition-changed hook, FR-ENT-19). `"initials"` (the DM's choice) is
// never filled. Runs no token-changed hooks (FR-MAP-20): nothing a hook reads changes.
import { creatureTypeOf, type EntityRecord } from "@shared/entities/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { readToken, toTokenRecord } from "../scenes-map/rows";
import type { HookEnv } from "./definition-hooks";

export function fillTokenCreatureType(
  env: HookEnv,
  before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  const type = creatureTypeOf(after);
  if (type === null || creatureTypeOf(before) !== null) return [];
  const where = and(eq(token.definitionId, after.id), isNull(token.creatureType));
  const rows = env.tx.select().from(token).where(where).orderBy(asc(token.seq)).all();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  env.tx
    .update(token)
    .set({ creatureType: type, updatedAt: env.ctx.clock.iso() })
    .where(inArray(token.id, ids))
    .run();
  return rows.map((r) => ({
    type: TOKEN_TYPE,
    id: r.id,
    before: toTokenRecord(r),
    after: readToken(env.tx, r.id),
  }));
}
