// ADR-0076: per-cell explored memory becomes exact shapes. At feature start, before the server
// listens, each remaining `fog_explored` row is converted into `fog_explored_shape` and deleted, one
// transaction per row, so a crash midway resumes on the next boot and an empty table is a no-op.
// Whole cells stay explored (nobody loses progress); what they showed behind walls stays until the
// DM's Forget explored. No event, no log row (a migration).

import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { fogExplored, legacyFogExplored } from "../../db/schema";
import { cellsToShape } from "./memory-shape";

/** Converts every old row; returns how many. */
export function upgradeExploredShapes(db: Db): number {
  const rows = db.select().from(legacyFogExplored).all();
  for (const r of rows) {
    const shape = cellsToShape({ box: [r.col0, r.row0, r.cols, r.rows], runs: r.runs });
    db.transaction((tx) => {
      tx.insert(fogExplored)
        .values({
          sceneId: r.sceneId,
          playerId: r.playerId,
          campaignId: r.campaignId,
          shape,
          updatedAt: r.updatedAt,
        })
        .onConflictDoNothing()
        .run();
      tx.delete(legacyFogExplored)
        .where(
          and(eq(legacyFogExplored.sceneId, r.sceneId), eq(legacyFogExplored.playerId, r.playerId)),
        )
        .run();
    });
  }
  return rows.length;
}
