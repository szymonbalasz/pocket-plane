// A token's server copies and its owner rewrite (FR-FOG-10, FR-MAP-74). Split from `commands.ts`
// so entities' owner-copy hook (FR-ENT-34, sprint 6) can rewrite tokens without loading the
// scene commands (and their scene hook registry) from the definition-hook registry.
import { footprint } from "@shared/scenes-map/geometry";
import { TOKEN_TYPE, type TokenRecord, type TokenSize } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import type { Tx } from "../../db/client";
import { token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { readToken } from "./rows";
import { runTokenChangedHooks } from "./token-hooks";
import { deriveSceneObject, rederiveDependants } from "./visibility-hooks";

const tokenChange = (before: TokenRecord | null, after: TokenRecord | null): RecordChange => ({
  type: TOKEN_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

/** What a token's copies depend on (FR-FOG-10 / -34 / -46). */
export interface TokenPlace {
  sceneId: string;
  col: number;
  row: number;
  size: TokenSize;
  ownerPlayerId: string | null;
  invisible?: boolean;
}

/**
 * FR-FOG-10 (ADR-0039 / ADR-0042): a token's server copies (`fogged`, `seenBy`) at a scene, cell
 * and size for its owner, derived in the writing command's transaction before its single write.
 * No `derive` hook → not fogged, `seenBy` null.
 */
export function tokenCopies(tx: Tx, t: TokenPlace) {
  const n = footprint(t.size);
  return deriveSceneObject(tx, {
    type: TOKEN_TYPE,
    sceneId: t.sceneId,
    cells: { col: t.col, row: t.row, w: n, h: n },
    ownerPlayerId: t.ownerPlayerId,
    invisible: t.invisible === true,
  });
}

/**
 * FR-MAP-74 / FR-ENT-34 (sprint 6): rewrites a token's owner inside the caller's transaction (a
 * pet's or a companion's owner changed): `map.updateToken`'s owner path minus intent and event
 * (copies, dependants, token-changed hooks). Unchanged → nothing.
 */
export function setTokenOwnerIn(
  env: Pick<CommandEnv, "tx" | "ctx" | "actor">,
  tokenId: string,
  ownerPlayerId: string | null,
): RecordChange[] {
  const { tx, ctx, actor } = env;
  const before = readToken(tx, tokenId);
  if (before.ownerPlayerId === ownerPlayerId) return [];
  tx.update(token)
    .set({
      ownerPlayerId,
      ...tokenCopies(tx, { ...before, ownerPlayerId }),
      updatedAt: ctx.clock.iso(),
    })
    .where(eq(token.id, tokenId))
    .run();
  const after = readToken(tx, tokenId);
  const dependants = rederiveDependants({ tx, ctx, actor }, tokenChange(before, after));
  const hookChanges = runTokenChangedHooks({ tx, ctx, actor }, before, after);
  return [tokenChange(before, readToken(tx, tokenId)), ...dependants, ...hookChanges];
}
