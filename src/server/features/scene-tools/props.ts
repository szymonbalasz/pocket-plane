// Prop commands (SCN §6 FR-SCN-16–19, §9; protocol §36). DM-only WS intents `scn.placeProp`,
// `scn.updateProp`, `scn.setPropHidden`, `scn.duplicateProp`, `scn.deleteProp`. Each is one
// transaction: validate → `assets.require` → caps → fog `derive` for a set or moved footprint
// (FR-SCN-35, before the write) → one write → one event-log entry → one event. IDs and time from
// ctx. Works on any scene of the campaign (prep); no change → no event.
import {
  PropDeleted,
  PropDuplicated,
  PropHidden,
  PropPlaced,
  PropRevealed,
  PropUpdated,
} from "@shared/events/scene-tools";
import { duplicatePropCell, type PropBox, propOverlapsMap } from "@shared/scene-tools/props";
import {
  PlacePropInput,
  PROPS_PER_CAMPAIGN_MAX,
  PROPS_PER_SCENE_MAX,
  PropIdInput,
  SCENE_PROP_TYPE,
  SCN_INTENTS,
  type ScenePropRecord,
  SetPropHiddenInput,
  UpdatePropInput,
} from "@shared/scene-tools/schemas";
import type { SceneRecord } from "@shared/scenes-map/schemas";
import { and, count, eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { prop, propSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { requireAsset } from "../assets-pipeline/commands";
import { campaignOf, findScene, getScene } from "../scenes-map/rows";
import { propFogged } from "./copies";
import { readProp } from "./rows";

/** FR-SCN-17: a locked prop keeps its footprint (the menu still works). */
export const PROP_LOCKED = "Prop is locked — unlock it first";
export const PROP_OFF_MAP = "Prop must overlap the map";

const propChange = (
  before: ScenePropRecord | null,
  after: ScenePropRecord | null,
): RecordChange => ({
  type: SCENE_PROP_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

/** A prop of the actor's campaign, else `not_found` (other campaigns look unknown). */
function getProp(env: CommandEnv, id: string): ScenePropRecord {
  const cid = campaignOf(env.actor);
  const r = env.tx
    .select({ id: prop.id })
    .from(prop)
    .where(and(eq(prop.id, id), eq(prop.campaignId, cid)))
    .get();
  if (!r) throw notFound("Prop not found");
  return readProp(env.tx, id) as ScenePropRecord;
}

function assertOnMap(s: SceneRecord, box: PropBox) {
  if (!propOverlapsMap(s, box)) {
    throw invalid(PROP_OFF_MAP, [{ path: ["col"], message: "Off the map" }]);
  }
}

/** FR-SCN-16: ≤ 200 per scene and ≤ 2,000 per campaign. */
function assertCaps(tx: Tx, cid: string, sceneId: string) {
  const n = (where: ReturnType<typeof eq>) =>
    tx.select({ n: count() }).from(prop).where(where).get()?.n ?? 0;
  if (n(eq(prop.sceneId, sceneId)) + 1 > PROPS_PER_SCENE_MAX) {
    throw conflict(`A scene holds at most ${PROPS_PER_SCENE_MAX} props`);
  }
  if (n(eq(prop.campaignId, cid)) + 1 > PROPS_PER_CAMPAIGN_MAX) {
    throw conflict(`A campaign holds at most ${PROPS_PER_CAMPAIGN_MAX} props`);
  }
}

type PropFields = Omit<ScenePropRecord, "id" | "campaignId" | "seq" | "fogged">;

/** Inserts one prop with `fogged` derived first (FR-SCN-35); returns the record. */
function insertProp(env: CommandEnv, cid: string, f: PropFields): ScenePropRecord {
  const { tx, ctx } = env;
  const id = ctx.ids.next();
  const now = ctx.clock.iso();
  const fogged = propFogged(tx, f.sceneId, f);
  tx.insert(prop)
    .values({ id, campaignId: cid, seq: propSeqNext, ...f, fogged, createdAt: now, updatedAt: now })
    .run();
  return readProp(tx, id) as ScenePropRecord;
}

/** FR-SCN-16: place an asset on a scene; default 1 × 1, visible, unlocked, `z` 0. */
export const placeProp = defineCommand({
  name: SCN_INTENTS.placeProp,
  input: PlacePropInput,
  execute(input, env): { propId: string } {
    const cid = campaignOf(env.actor);
    const s = getScene(env.tx, cid, input.sceneId);
    const assetId = requireAsset(env, input.assetId).id;
    const box = { col: input.col, row: input.row, w: input.w ?? 1, h: input.h ?? 1 };
    assertOnMap(s, box);
    assertCaps(env.tx, cid, s.id);
    const after = insertProp(env, cid, {
      sceneId: s.id,
      assetId,
      ...box,
      rotation: 0,
      z: 0,
      hidden: input.hidden ?? false,
      locked: false,
    });
    env.emit({
      type: PropPlaced.type,
      campaignId: cid,
      payload: { propId: after.id },
      changes: [propChange(null, after)],
    });
    return { propId: after.id };
  },
});

/**
 * FR-SCN-17: move, resize, rotate, reorder, lock / unlock, change the image. Moving or resizing a
 * locked prop → `conflict`; a new footprint must overlap the map and re-derives `fogged`.
 */
export const updateProp = defineCommand({
  name: SCN_INTENTS.updateProp,
  input: UpdatePropInput,
  execute(input, env): void {
    const { tx, ctx } = env;
    const before = getProp(env, input.propId);
    const box = {
      col: input.col ?? before.col,
      row: input.row ?? before.row,
      w: input.w ?? before.w,
      h: input.h ?? before.h,
    };
    const moved =
      box.col !== before.col || box.row !== before.row || box.w !== before.w || box.h !== before.h;
    if (moved && before.locked) throw conflict(PROP_LOCKED);
    const set: Partial<typeof prop.$inferInsert> = {};
    if (moved) {
      assertOnMap(findScene(tx, before.campaignId, before.sceneId) as SceneRecord, box);
      Object.assign(set, box, { fogged: propFogged(tx, before.sceneId, box) });
    }
    if (input.rotation !== undefined && input.rotation !== before.rotation) {
      set.rotation = input.rotation;
    }
    if (input.z !== undefined && input.z !== before.z) set.z = input.z;
    if (input.locked !== undefined && input.locked !== before.locked) set.locked = input.locked;
    if (input.assetId !== undefined && input.assetId !== before.assetId) {
      set.assetId = requireAsset(env, input.assetId).id;
    }
    if (Object.keys(set).length === 0) return;
    tx.update(prop)
      .set({ ...set, updatedAt: ctx.clock.iso() })
      .where(eq(prop.id, before.id))
      .run();
    env.emit({
      type: PropUpdated.type,
      campaignId: before.campaignId,
      payload: { propId: before.id },
      changes: [propChange(before, readProp(tx, before.id))],
    });
  },
});

/** FR-SCN-19: hide → players get a `delete`; reveal → an `upsert` (FR-ASSET-12). Unchanged → no event. */
export const setPropHidden = defineCommand({
  name: SCN_INTENTS.setPropHidden,
  input: SetPropHiddenInput,
  execute({ propId, hidden }, env): void {
    const { tx, ctx } = env;
    const before = getProp(env, propId);
    if (before.hidden === hidden) return;
    tx.update(prop).set({ hidden, updatedAt: ctx.clock.iso() }).where(eq(prop.id, propId)).run();
    env.emit({
      type: hidden ? PropHidden.type : PropRevealed.type,
      campaignId: before.campaignId,
      payload: { propId },
      changes: [propChange(before, readProp(tx, propId))],
    });
  },
});

/**
 * FR-SCN-17 Duplicate: same asset, size, rotation, `z`, hidden and locked flags; at `col + w` on
 * the same row if on the map, else `col − w`, else the source cell; `fogged` derived there.
 */
export const duplicateProp = defineCommand({
  name: SCN_INTENTS.duplicateProp,
  input: PropIdInput,
  execute({ propId }, env): { propId: string } {
    const src = getProp(env, propId);
    const cid = src.campaignId;
    const s = findScene(env.tx, cid, src.sceneId) as SceneRecord;
    assertCaps(env.tx, cid, s.id);
    const at = duplicatePropCell(s, src);
    const after = insertProp(env, cid, {
      sceneId: s.id,
      assetId: requireAsset(env, src.assetId).id,
      col: at.col,
      row: at.row,
      w: src.w,
      h: src.h,
      rotation: src.rotation,
      z: src.z,
      hidden: src.hidden,
      locked: src.locked,
    });
    env.emit({
      type: PropDuplicated.type,
      campaignId: cid,
      payload: { propId: after.id },
      changes: [propChange(null, after)],
    });
    return { propId: after.id };
  },
});

/** FR-SCN-17 Delete. */
export const deleteProp = defineCommand({
  name: SCN_INTENTS.deleteProp,
  input: PropIdInput,
  execute({ propId }, env): void {
    const before = getProp(env, propId);
    env.tx.delete(prop).where(eq(prop.id, propId)).run();
    env.emit({
      type: PropDeleted.type,
      campaignId: before.campaignId,
      payload: { propId },
      changes: [propChange(before, null)],
    });
  },
});
