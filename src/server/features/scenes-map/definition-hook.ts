// FR-MAP-20: token display copies follow a definition edit, inside `entities.update`'s
// transaction (FR-ENT-19). Size and speed (FR-MAP-36) always follow; the image follows only on
// tokens still showing the old portrait (#127); `characterId` is re-asserted (FR-MAP-50). Names,
// shapes (FR-MAP-35) and cells untouched (#126). A size change re-derives `fogged` / `seenBy` for
// the new footprint (FR-FOG-10) and the token's dependants (`rederive`, FR-FOG-35); a token whose
// party-level hidden flips runs the token-changed hooks, their rows joining the changes
// (FR-FOG-13, ADR-0039). No other token-changed hooks run.
import type { EntityRecord } from "@shared/entities/schemas";
import { footprint } from "@shared/scenes-map/geometry";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { asc, eq } from "drizzle-orm";
import { token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import type { HookEnv } from "../entities/definition-hooks";
import { characterIdOf } from "./character-copy";
import { readToken, toTokenRecord } from "./rows";
import { runTokenChangedHooks } from "./token-hooks";
import { deriveSceneObject, rederiveDependants, tokenHiddenForPlayers } from "./visibility-hooks";

export function refreshTokenCopies(
  env: HookEnv,
  before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  const sizeChanged = before.statBlock.size !== after.statBlock.size;
  const speed = after.statBlock.speed ?? null;
  const speedChanged = (before.statBlock.speed ?? null) !== speed;
  const portraitChanged = before.portraitAssetId !== after.portraitAssetId;
  const characterId = characterIdOf(after);
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
  const hookChanges: RecordChange[] = [];
  const now = env.ctx.clock.iso();
  for (const t of rows) {
    const set: Partial<typeof token.$inferInsert> = {};
    if (sizeChanged && t.size !== after.statBlock.size) {
      set.size = after.statBlock.size;
      const n = footprint(after.statBlock.size);
      const { fogged, seenBy } = deriveSceneObject(env.tx, {
        type: TOKEN_TYPE,
        sceneId: t.sceneId,
        cells: { col: t.col, row: t.row, w: n, h: n },
        ownerPlayerId: t.ownerPlayerId,
        invisible: t.invisible === true,
      });
      if (fogged !== (t.fogged === true)) set.fogged = fogged;
      set.seenBy = seenBy;
    }
    if (speedChanged && t.speed !== speed) set.speed = speed;
    if (portraitChanged && t.imageAssetId === before.portraitAssetId) {
      set.imageAssetId = after.portraitAssetId;
    }
    // FR-MAP-50: a definition never changes kind, so this only re-asserts the copy.
    if (t.characterId !== characterId) set.characterId = characterId;
    if (Object.keys(set).length === 0) continue;
    env.tx
      .update(token)
      .set({ ...set, updatedAt: now })
      .where(eq(token.id, t.id))
      .run();
    const next = readToken(env.tx, t.id);
    changes.push({ type: TOKEN_TYPE, id: t.id, before: t, after: next });
    if (set.size !== undefined)
      changes.push(
        ...rederiveDependants(env, { type: TOKEN_TYPE, id: t.id, before: t, after: next }),
      );
    if (tokenHiddenForPlayers(t) !== tokenHiddenForPlayers(next)) {
      hookChanges.push(...runTokenChangedHooks(env, t, next));
    }
  }
  return [...changes, ...hookChanges];
}
