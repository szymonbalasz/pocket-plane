// A mirror follows its source token (FR-MIR-08 – -11), a line in scenes-map's `tokenChangedHooks`.
// It moves by the token's own step, keeps its name, art and size, and stops showing while the token
// is hidden or Invisible. A teleport moves the token somewhere the old distance means nothing, so
// it sets the mode to Hidden and leaves the mirror for the DM to place (FR-MIR-10). Never rejects
// a move (ADR-0031). Writes through `env.tx` only.
import { footprint, type MapRect, overlapsMap } from "@shared/scenes-map/geometry";
import { type SceneRecord, type TokenRecord, tokenImageOf } from "@shared/scenes-map/schemas";
import { TOKEN_MIRROR_TYPE, type TokenMirrorRecord } from "@shared/token-mirrors/schemas";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { tokenMirror } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { findScene } from "../scenes-map/rows";
import { deriveSceneObject, type SceneRead } from "../scenes-map/visibility-hooks";
import { mirrorsOfToken, readMirror } from "./rows";

type Env = Pick<CommandEnv, "tx" | "ctx" | "actor">;
type At = { col: number; row: number; size: TokenRecord["size"] };

/** FR-MIR-08: what a mirror copies from its source. */
export const sourceCopies = (t: TokenRecord) => ({
  name: t.name,
  // FR-FORM-08: the drawn art (the form copy, else the token's own image).
  imageAssetId: tokenImageOf(t),
  creatureType: t.creatureType ?? null,
  size: t.size,
  shape: t.shape,
});

/** FR-MIR-09: the source hidden or Invisible, or no part of the mirror on the map. */
export const isSuppressed = (
  t: { hidden: boolean; invisible?: boolean | undefined },
  s: MapRect,
  at: At,
): boolean => t.hidden === true || t.invisible === true || !overlapsMap(s, at.col, at.row, at.size);

/** FR-MIR-06: `visible` mode's sight copies at a cell (FR-FOG-10). */
export function mirrorSight(read: SceneRead, sceneId: string, at: At) {
  const n = footprint(at.size);
  return deriveSceneObject(read, {
    type: TOKEN_MIRROR_TYPE,
    sceneId,
    cells: { col: at.col, row: at.row, w: n, h: n },
  });
}

export const mirrorChange = (
  before: TokenMirrorRecord | null,
  after: TokenMirrorRecord | null,
): RecordChange => ({
  type: TOKEN_MIRROR_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

const same = (a: TokenMirrorRecord, b: Partial<TokenMirrorRecord>) =>
  (Object.keys(b) as (keyof TokenMirrorRecord)[]).every((k) => a[k] === b[k]);

/**
 * FR-MIR-08 – -11: brings a token's mirrors up to date with a write of that token; the rows join
 * the write's event. `after` null: the mirrors go with the token.
 */
export function syncMirrors(
  env: Env,
  before: TokenRecord,
  after: TokenRecord | null,
  teleport = false,
): RecordChange[] {
  const { tx, ctx } = env;
  const rows = mirrorsOfToken(tx, before.id);
  if (rows.length === 0) return [];
  if (after === null) {
    tx.delete(tokenMirror).where(eq(tokenMirror.tokenId, before.id)).run();
    return rows.map((m) => mirrorChange(m, null));
  }
  const s = findScene(tx, after.campaignId, after.sceneId) as SceneRecord;
  const moved = before.col !== after.col || before.row !== after.row;
  const dCol = teleport ? 0 : after.col - before.col;
  const dRow = teleport ? 0 : after.row - before.row;
  const copies = sourceCopies(after);
  const out: RecordChange[] = [];
  for (const m of rows) {
    const at = { col: m.col + dCol, row: m.row + dRow, size: after.size };
    const stepped = at.col !== m.col || at.row !== m.row || at.size !== m.size;
    const set = {
      ...copies,
      col: at.col,
      row: at.row,
      suppressed: isSuppressed(after, s, at),
      ...(teleport && moved ? { mode: "hidden" as const } : {}),
    };
    if (!stepped && same(m, set)) continue;
    const sight = stepped ? mirrorSight(tx, m.sceneId, at) : {};
    tx.update(tokenMirror)
      .set({ ...set, ...sight, updatedAt: ctx.clock.iso() })
      .where(eq(tokenMirror.id, m.id))
      .run();
    out.push(mirrorChange(m, readMirror(tx, m.id)));
  }
  return out;
}

/** The hook line. */
export function mirrorTokenHook(
  env: Env & { teleport?: boolean },
  before: TokenRecord,
  after: TokenRecord | null,
): RecordChange[] {
  return syncMirrors(env, before, after, env.teleport === true);
}
