// Scene-tools' scene lifecycle hook (FR-SCN-31, ADR-0039), a line in scenes-map's `sceneHooks`.
// `duplicated`: copies the structure row (same `n`s, `rev`, door fog flags) and every prop (new
// IDs from `ctx`, same fields); kept templates are not copied. `fogged` / `f` and the per-player
// `seenBy` / `doorSeen` are copied, not re-derived: fog's own `duplicated` line copies the fog row
// unchanged (FR-FOG-24), so the copies stay exact whatever the hook order. `deleting`: every SCN row of the scene as a delete, before
// the FK cascade removes them. Writes through `env.tx` only; never emits.
import {
  AOE_TEMPLATE_TYPE,
  PROPS_PER_CAMPAIGN_MAX,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
} from "@shared/scene-tools/schemas";
import type { SceneRecord } from "@shared/scenes-map/schemas";
import { count, eq } from "drizzle-orm";
import { conflict } from "../../commands/errors";
import { prop, propSeqNext, sceneStructure } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { SceneHook, SceneHookEnv } from "../scenes-map/scene-hooks";
import { readProp, readStructure, sceneProps, sceneTemplates } from "./rows";

function duplicated(env: SceneHookEnv, source: SceneRecord, copy: SceneRecord): RecordChange[] {
  const { tx, ctx } = env;
  const now = ctx.clock.iso();
  const changes: RecordChange[] = [];
  const structure = readStructure(tx, source.id);
  if (structure) {
    tx.insert(sceneStructure)
      .values({
        sceneId: copy.id,
        campaignId: copy.campaignId,
        rev: structure.rev,
        nextN: structure.nextN,
        walls: structure.walls,
        doors: structure.doors,
        doorSeen: structure.doorSeen ?? null,
        updatedAt: now,
      })
      .run();
    changes.push({
      type: SCENE_STRUCTURE_TYPE,
      id: copy.id,
      before: null,
      after: readStructure(tx, copy.id),
    });
  }
  const props = sceneProps(tx, source.id);
  if (props.length === 0) return changes;
  const held =
    tx.select({ n: count() }).from(prop).where(eq(prop.campaignId, copy.campaignId)).get()?.n ?? 0;
  if (held + props.length > PROPS_PER_CAMPAIGN_MAX) {
    throw conflict(`A campaign holds at most ${PROPS_PER_CAMPAIGN_MAX} props`);
  }
  for (const p of props) {
    const id = ctx.ids.next();
    tx.insert(prop)
      .values({
        id,
        campaignId: copy.campaignId,
        sceneId: copy.id,
        seq: propSeqNext,
        assetId: p.assetId,
        col: p.col,
        row: p.row,
        w: p.w,
        h: p.h,
        rotation: p.rotation,
        z: p.z,
        hidden: p.hidden,
        locked: p.locked,
        fogged: p.fogged === true,
        seenBy: p.seenBy ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    changes.push({ type: SCENE_PROP_TYPE, id, before: null, after: readProp(tx, id) });
  }
  return changes;
}

function deleting(env: SceneHookEnv, scene: SceneRecord): RecordChange[] {
  const { tx } = env;
  const changes: RecordChange[] = [];
  const structure = readStructure(tx, scene.id);
  if (structure) {
    changes.push({ type: SCENE_STRUCTURE_TYPE, id: scene.id, before: structure, after: null });
  }
  for (const p of sceneProps(tx, scene.id)) {
    changes.push({ type: SCENE_PROP_TYPE, id: p.id, before: p, after: null });
  }
  for (const t of sceneTemplates(tx, scene.id)) {
    changes.push({ type: AOE_TEMPLATE_TYPE, id: t.id, before: t, after: null });
  }
  return changes;
}

export const scnSceneHook: SceneHook = {
  name: "scene-tools.scene-rows",
  duplicated,
  deleting,
};
