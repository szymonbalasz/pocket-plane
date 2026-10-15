// Test support for fog-of-war.
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { sceneFog } from "../../db/schema";

/**
 * A scene as created before this build: no `fog` row, every cell clear (FR-FOG-01). Fog's own
 * command / hook tests start from it; new scenes get a fully fogged row (FR-FOG-02).
 */
export function dropFogRow(db: Pick<Db, "delete">, sceneId: string): void {
  db.delete(sceneFog).where(eq(sceneFog.sceneId, sceneId)).run();
}
