// FR-FOG-40 (sprint 4, review A4): the one-time vision-model upgrade. Copies written under sprint
// 3's model (senses absent = no sight, no map edges, no simplification) are stale once the 999 ft
// default ships. At feature start, after the `seenBy` backfill and **before the server listens**,
// a DB whose stored vision-model version (`db_meta` key `fog-vision-model`; a DB created from
// scratch is stamped with the current one, `db/meta.ts`) is below `VISION_MODEL` re-derives
// every campaign's active scene (and scenes without a fog row) and marks the other scenes
// `visionStale` (re-derived at activation, FR-FOG-35); one transaction per campaign's marking and
// per scene. No event, no log row (a migration). The version is written last, so a crash midway
// reruns the step on the next boot; same version → no-op.
import { eq } from "drizzle-orm";
import type { CommandContext } from "../../commands/context";
import type { Db } from "../../db/client";
import { VISION_MODEL, VISION_MODEL_KEY } from "../../db/meta";
import { campaign, dbMeta } from "../../db/schema";
import { markScenesStale, rederiveScene } from "./rederive";

/** The stored vision-model version (absent = 1, sprint 3). */
export function visionModelOf(db: Pick<Db, "select">): number {
  const v = db.select().from(dbMeta).where(eq(dbMeta.key, VISION_MODEL_KEY)).get()?.value;
  return v === undefined ? 1 : Number(v);
}

/** Runs the upgrade if needed; returns how many scenes were re-derived (0 = nothing to do). */
export function upgradeVisionModel(db: Db, ctx: CommandContext): number {
  if (visionModelOf(db) >= VISION_MODEL) return 0;
  const actor = { role: "system" as const, playerId: null, campaignId: null };
  let n = 0;
  for (const c of db.select({ id: campaign.id }).from(campaign).all()) {
    const now = db.transaction((tx) => markScenesStale({ tx, ctx, actor }, c.id));
    for (const sceneId of now) {
      db.transaction((tx) => {
        rederiveScene({ tx, ctx, actor }, sceneId);
      });
      n++;
    }
  }
  const value = String(VISION_MODEL);
  db.insert(dbMeta)
    .values({ key: VISION_MODEL_KEY, value })
    .onConflictDoUpdate({ target: dbMeta.key, set: { value } })
    .run();
  return n;
}
