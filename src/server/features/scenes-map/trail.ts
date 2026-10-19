// Stored combat trails (sprint 5, FR-MAP-65, -66): a token's `trail` = this turn's committed
// cells, oldest first (the start cell, then each move's end cell; beyond 20 segments the oldest
// cell drops). Written only here, called by combat in the move's / turn command's transaction
// (FR-CBT-97). `map.moveToken` and `map.setTokenHidden` build their token upsert after the
// token-changed hooks, so `appendTrail` / `resetTrail` return nothing; `clearTrails` returns the
// upserts its caller lists in its own event.
import {
  TOKEN_TYPE,
  type TokenRecord,
  TRAIL_CELLS_MAX,
  type TrailCell,
} from "@shared/scenes-map/schemas";
import { and, eq, isNotNull } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { readToken, toTokenRecord } from "./rows";

type Env = Pick<CommandEnv, "tx">;
type Cell = { col: number; row: number };

const same = (a: TrailCell, b: TrailCell) => a[0] === b[0] && a[1] === b[1];

/**
 * FR-MAP-65 / -66: appends `from → to` to the token's trail (starting it at `from`). Nothing while
 * the token is `hidden` (a hidden move is never recorded) or for a move that stays put.
 */
export function appendTrail(env: Env, t: TokenRecord, from: Cell, to: Cell): void {
  if (from.col === to.col && from.row === to.row) return;
  const now = readToken(env.tx, t.id);
  if (now.hidden) return;
  const a: TrailCell = [from.col, from.row];
  const b: TrailCell = [to.col, to.row];
  const cells: TrailCell[] = [...(now.trail?.cells ?? [])];
  const last = cells.at(-1);
  if (!last || !same(last, a)) cells.push(a);
  cells.push(b);
  env.tx
    .update(token)
    .set({ trail: { cells: cells.slice(-TRAIL_CELLS_MAX) } })
    .where(eq(token.id, t.id))
    .run();
}

/** FR-MAP-66 (review B5): a reveal starts the trail afresh, so hidden moves never show. */
export function resetTrail(env: Env, t: TokenRecord): void {
  env.tx.update(token).set({ trail: null }).where(eq(token.id, t.id)).run();
}

/** FR-MAP-65: every trail on the scene → null (Next, Prev, Start round 1, End); the upserts. */
export function clearTrails(env: Env, sceneId: string): RecordChange[] {
  const rows = env.tx
    .select()
    .from(token)
    .where(and(eq(token.sceneId, sceneId), isNotNull(token.trail)))
    .all()
    .map(toTokenRecord);
  return rows.map((before) => {
    env.tx.update(token).set({ trail: null }).where(eq(token.id, before.id)).run();
    return { type: TOKEN_TYPE, id: before.id, before, after: { ...before, trail: null } };
  });
}
