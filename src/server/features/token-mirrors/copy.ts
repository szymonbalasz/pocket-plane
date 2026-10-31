// FR-MIR-14: a scene copy keeps its mirrors, on the copied tokens. Leaf module: scenes-map's scene
// copy calls it.
import { TOKEN_MIRROR_TYPE } from "@shared/token-mirrors/schemas";
import type { CommandEnv } from "../../commands/commands";
import { tokenMirror, tokenMirrorSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { readMirror, sceneMirrors } from "./rows";

export function copyMirrors(
  env: Pick<CommandEnv, "tx" | "ctx">,
  sourceSceneId: string,
  copySceneId: string,
  tokenIds: ReadonlyMap<string, string>,
): RecordChange[] {
  const { tx, ctx } = env;
  const now = ctx.clock.iso();
  return sceneMirrors(tx, sourceSceneId).flatMap((m) => {
    const tokenId = tokenIds.get(m.tokenId);
    if (!tokenId) return [];
    const id = ctx.ids.next();
    const { seq: _seq, ...fields } = m;
    tx.insert(tokenMirror)
      .values({
        ...fields,
        id,
        sceneId: copySceneId,
        tokenId,
        seq: tokenMirrorSeqNext,
        seenBy: m.seenBy ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return [{ type: TOKEN_MIRROR_TYPE, id, before: null, after: readMirror(tx, id) }];
  });
}
