// Test support for fog-of-war.
import { NO_SENSES } from "@shared/fog-of-war/vision";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { sceneFog } from "../../db/schema";

/**
 * A scene as created before this build: no `fog` row, every cell clear (FR-FOG-01). Fog's own
 * command / hook tests start from it; new scenes get a fully fogged row (FR-FOG-02).
 */
export function dropFogRow(db: Pick<Db, "delete">, sceneId: string): void {
  db.delete(sceneFog).where(eq(sceneFog.sceneId, sceneId)).run();
}

/**
 * Sprint 4 (FR-FOG-32): every creature definition without stored senses gets 0 / 0 (sprint 3's
 * default: no sight), so fog tests written for the static fog keep their exact expectations
 * under the 999 ft default (the `vision-legacy` patch for hand-built setups). Run before tokens
 * are placed; definitions created later keep Normal vision.
 */
export function legacySenses(db: Pick<Db, "run">): void {
  db.run(
    sql`UPDATE entity SET stat_block = json_set(stat_block, '$.senses', json(${JSON.stringify(NO_SENSES)})) WHERE json_extract(stat_block, '$.senses') IS NULL`,
  );
}
