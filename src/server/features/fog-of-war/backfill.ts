// FR-FOG-40 (OQ-FOG-27 A): boot backfill of the per-player copies. The schema push adds
// `seen_by` / `door_seen` as null; until a scene is backfilled, null reads as hidden for every
// player (fail closed, `fogHidden` / `doorSeenBy`). At feature start, **before the server
// listens** (a start hook), every scene with a subject whose copy is still null re-derives, one
// transaction per scene. Idempotent: a rerun finds nothing. No event, no log row (a migration,
// like FR-MAP-50's backfill): `updatedAt` stays, so every wire is byte-equal to sprint 2's.
import { isNull } from "drizzle-orm";
import type { CommandContext } from "../../commands/context";
import type { Db } from "../../db/client";
import { aoeTemplate, prop, sceneStructure, token } from "../../db/schema";
import { rederiveScene } from "./rederive";

/** Scenes holding a subject with a null copy (token / prop / template `seenBy`, `doorSeen`). */
export function scenesNeedingBackfill(db: Pick<Db, "select">): string[] {
  const ids = new Set<string>();
  const add = (rows: { sceneId: string }[]) => {
    for (const r of rows) ids.add(r.sceneId);
  };
  add(db.select({ sceneId: token.sceneId }).from(token).where(isNull(token.seenBy)).all());
  add(db.select({ sceneId: prop.sceneId }).from(prop).where(isNull(prop.seenBy)).all());
  add(
    db
      .select({ sceneId: aoeTemplate.sceneId })
      .from(aoeTemplate)
      .where(isNull(aoeTemplate.seenBy))
      .all(),
  );
  add(
    db
      .select({ sceneId: sceneStructure.sceneId })
      .from(sceneStructure)
      .where(isNull(sceneStructure.doorSeen))
      .all(),
  );
  return [...ids].sort();
}

/** Re-derives every scene that needs it; returns how many. A throw stops the boot. */
export function backfillSeenBy(db: Db, ctx: CommandContext): number {
  const scenes = scenesNeedingBackfill(db);
  for (const sceneId of scenes) {
    db.transaction((tx) => {
      const actor = { role: "system" as const, playerId: null, campaignId: null };
      rederiveScene({ tx, ctx, actor }, sceneId, { migration: true });
    });
  }
  return scenes.length;
}
