// FR-OVW-33: a party miniature follows its character. The definition-changed hook line (entities'
// registry): a change to the name, art or owner reaches every linked miniature inside
// `entities.update`'s transaction, unlike tokens (#126: the DM's choice). The hook never emits: the
// rows ride on `EntityUpdated`. Position, size, shape and flags stay as they are.
import type { EntityRecord } from "@shared/entities/schemas";
import { miniatureNameOf } from "@shared/overview-scenes/schemas";
import { asc, eq } from "drizzle-orm";
import { overviewItem } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import type { HookEnv } from "../entities/definition-hooks";
import { itemChange, readItem, toItemRecord } from "./rows";

export function miniatureCharacterHook(
  env: HookEnv,
  before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  if (after.kind !== "character") return [];
  const owner = after.ownerPlayerId ?? null;
  const artChanged = before.portraitAssetId !== after.portraitAssetId;
  if (before.name === after.name && !artChanged && (before.ownerPlayerId ?? null) === owner) {
    return [];
  }
  // FR-ASSET-15: propagated asset copies go through `assets.require` too.
  if (artChanged && after.portraitAssetId) requireAsset(env, after.portraitAssetId);
  const rows = env.tx
    .select()
    .from(overviewItem)
    .where(eq(overviewItem.characterId, after.id))
    .orderBy(asc(overviewItem.seq))
    .all()
    .map(toItemRecord);
  const text = miniatureNameOf(after.name);
  const now = env.ctx.clock.iso();
  const changes: RecordChange[] = [];
  for (const b of rows) {
    const set: Partial<typeof overviewItem.$inferInsert> = {};
    if (b.text !== text) set.text = text;
    if (b.assetId !== after.portraitAssetId) set.assetId = after.portraitAssetId;
    if (b.ownerPlayerId !== owner) set.ownerPlayerId = owner;
    if (Object.keys(set).length === 0) continue;
    env.tx
      .update(overviewItem)
      .set({ ...set, updatedAt: now })
      .where(eq(overviewItem.id, b.id))
      .run();
    changes.push(itemChange(b, readItem(env.tx, b.id)));
  }
  return changes;
}
