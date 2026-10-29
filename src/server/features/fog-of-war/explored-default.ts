// FR-FOG-29 (#383): the one-time "Remember explored areas on" upgrade. New scenes start with the
// setting on; at feature start, before the server listens, a DB whose `db_meta` key
// `fog-explored-default` is below `EXPLORED_DEFAULT` (a DB created from scratch is stamped with
// it, `db/meta.ts`) switches every existing fog row on, in one transaction with the key. No event,
// no log row (a migration); memory grows from the next move or re-derive, as `fog.setExplored`.
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { EXPLORED_DEFAULT, EXPLORED_DEFAULT_KEY } from "../../db/meta";
import { dbMeta, sceneFog } from "../../db/schema";

/** The stored explored-default version (absent = 0, before #383). */
export function exploredDefaultOf(db: Pick<Db, "select">): number {
  const v = db.select().from(dbMeta).where(eq(dbMeta.key, EXPLORED_DEFAULT_KEY)).get()?.value;
  return v === undefined ? 0 : Number(v);
}

/** Runs the upgrade if needed; returns how many scenes were switched on (0 = nothing to do). */
export function upgradeExploredDefault(db: Db): number {
  if (exploredDefaultOf(db) >= EXPLORED_DEFAULT) return 0;
  return db.transaction((tx) => {
    const n = tx
      .update(sceneFog)
      .set({ explored: true })
      .where(eq(sceneFog.explored, false))
      .returning({ id: sceneFog.sceneId })
      .all().length;
    const value = String(EXPLORED_DEFAULT);
    tx.insert(dbMeta)
      .values({ key: EXPLORED_DEFAULT_KEY, value })
      .onConflictDoUpdate({ target: dbMeta.key, set: { value } })
      .run();
    return n;
  });
}
