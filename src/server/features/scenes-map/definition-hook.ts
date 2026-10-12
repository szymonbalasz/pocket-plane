// FR-MAP-20: token display copies follow a definition edit, inside `entities.update`'s
// transaction (FR-ENT-19). Size always follows; the image follows only on tokens still showing
// the old portrait (#127). Names and cells untouched (#126). Runs no token-changed hooks.
import type { EntityRecord } from "@shared/entities/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { asc, eq } from "drizzle-orm";
import { token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import type { HookEnv } from "../entities/definition-hooks";
import { readToken, toTokenRecord } from "./rows";

export function refreshTokenCopies(
  env: HookEnv,
  before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  const sizeChanged = before.statBlock.size !== after.statBlock.size;
  const portraitChanged = before.portraitAssetId !== after.portraitAssetId;
  if (!sizeChanged && !portraitChanged) return [];
  // FR-ASSET-15: propagated asset copies go through `assets.require` too.
  if (portraitChanged && after.portraitAssetId) requireAsset(env, after.portraitAssetId);
  const rows = env.tx
    .select()
    .from(token)
    .where(eq(token.definitionId, after.id))
    .orderBy(asc(token.seq))
    .all()
    .map(toTokenRecord);
  const changes: RecordChange[] = [];
  const now = env.ctx.clock.iso();
  for (const t of rows) {
    const set: Partial<typeof token.$inferInsert> = {};
    if (sizeChanged && t.size !== after.statBlock.size) set.size = after.statBlock.size;
    if (portraitChanged && t.imageAssetId === before.portraitAssetId) {
      set.imageAssetId = after.portraitAssetId;
    }
    if (Object.keys(set).length === 0) continue;
    env.tx
      .update(token)
      .set({ ...set, updatedAt: now })
      .where(eq(token.id, t.id))
      .run();
    changes.push({ type: TOKEN_TYPE, id: t.id, before: t, after: readToken(env.tx, t.id) });
  }
  return changes;
}
