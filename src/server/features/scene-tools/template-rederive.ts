// FR-SCN-46 (sprint 4): the boot re-derive of DM templates' fog copies. Sprint 4 changed which
// cells a template affects (> 50 % covered, FR-SCN-41), so the stored `fogged` / `seenBy` of a
// DM-placed kept template may be stale. At scene-tools' feature start, after fog's own boot
// steps and **before the server listens**, one transaction re-runs `derive` over every such
// template's new uncut cells and writes only the rows whose copies change. No event, no log row,
// no `updatedAt` (a migration, like FR-FOG-40's upgrade); nobody is connected yet, and the next
// snapshot carries the rows. A crash before the commit leaves the old copies; the next boot
// redoes it. Rerun = no-op. Player-placed templates are never fog subjects (FR-SCN-27).
import { eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import { aoeTemplate } from "../../db/schema";
import { readScene } from "../scenes-map/rows";
import type { SceneObjectCopies } from "../scenes-map/visibility-hooks";
import { templateCopies } from "./copies";
import { toTemplateRecord } from "./rows";

const sameCopies = (
  t: { fogged?: boolean; seenBy?: string[] | null },
  c: SceneObjectCopies,
): boolean => {
  if ((t.fogged === true) !== c.fogged) return false;
  const a = t.seenBy ?? null;
  if (a === null || c.seenBy === null) return a === c.seenBy;
  const s = new Set(a);
  return a.length === c.seenBy.length && c.seenBy.every((p) => s.has(p));
};

/** Returns how many templates were re-derived (0 = nothing stale). */
export function rederiveDmTemplates(db: Db): number {
  return db.transaction((tx) => {
    let n = 0;
    const rows = tx
      .select()
      .from(aoeTemplate)
      .where(isNull(aoeTemplate.placedByPlayerId))
      .orderBy(aoeTemplate.seq)
      .all();
    for (const row of rows) {
      const t = toTemplateRecord(row);
      const c = templateCopies(tx, readScene(tx, t.sceneId), t, null);
      if (sameCopies(t, c)) continue;
      tx.update(aoeTemplate)
        .set({ fogged: c.fogged, seenBy: c.seenBy })
        .where(eq(aoeTemplate.id, t.id))
        .run();
      n++;
    }
    return n;
  });
}
