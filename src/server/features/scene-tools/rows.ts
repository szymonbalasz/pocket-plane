// Row ↔ record mapping and reads for scene-tools (SCN §8, §9). Wire records are compact: no
// timestamps; `fogged` only when true; `campaignId` stays for the registry's scope gate.
import {
  type AoeTemplateRecord,
  DEFAULT_DIAGONAL_RULE,
  type DiagonalRule,
  type MapSettingsRecord,
  type PropRotation,
  type ScenePropRecord,
  type SceneStructureRecord,
} from "@shared/scene-tools/schemas";
import { asc, eq } from "drizzle-orm";
import { aoeTemplate, mapSettings, prop, sceneStructure } from "../../db/schema";
import type { SceneRead } from "../scenes-map/visibility-hooks";

type StructureRow = typeof sceneStructure.$inferSelect;
type PropRow = typeof prop.$inferSelect;
type TemplateRow = typeof aoeTemplate.$inferSelect;
type SettingsRow = typeof mapSettings.$inferSelect;

export const toStructureRecord = (r: StructureRow): SceneStructureRecord => ({
  id: r.sceneId,
  campaignId: r.campaignId,
  rev: r.rev,
  nextN: r.nextN,
  walls: r.walls,
  doors: r.doors,
});

export function toPropRecord(r: PropRow): ScenePropRecord {
  const rec: ScenePropRecord = {
    id: r.id,
    campaignId: r.campaignId,
    sceneId: r.sceneId,
    seq: r.seq,
    assetId: r.assetId,
    col: r.col,
    row: r.row,
    w: r.w,
    h: r.h,
    rotation: r.rotation as PropRotation,
    z: r.z,
    hidden: r.hidden,
    locked: r.locked,
  };
  return r.fogged ? { ...rec, fogged: true } : rec;
}

export function toTemplateRecord(r: TemplateRow): AoeTemplateRecord {
  const rec: AoeTemplateRecord = {
    id: r.id,
    campaignId: r.campaignId,
    sceneId: r.sceneId,
    shape: r.shape,
    x: r.x,
    y: r.y,
    size: r.size,
    width: r.width,
    angle: r.angle,
    label: r.label,
    placedByPlayerId: r.placedByPlayerId,
    hidden: r.hidden,
  };
  return r.fogged ? { ...rec, fogged: true } : rec;
}

export const toSettingsRecord = (r: SettingsRow): MapSettingsRecord => ({
  id: r.campaignId,
  diagonalRule: r.diagonalRule,
});

// ---------- one scene ----------

/** The scene's structure, or null (no row = no walls, no doors). */
export function readStructure(read: SceneRead, sceneId: string): SceneStructureRecord | null {
  const r = read.select().from(sceneStructure).where(eq(sceneStructure.sceneId, sceneId)).get();
  return r ? toStructureRecord(r) : null;
}

export function readProp(read: SceneRead, id: string): ScenePropRecord | null {
  const r = read.select().from(prop).where(eq(prop.id, id)).get();
  return r ? toPropRecord(r) : null;
}

export function readTemplate(read: SceneRead, id: string): AoeTemplateRecord | null {
  const r = read.select().from(aoeTemplate).where(eq(aoeTemplate.id, id)).get();
  return r ? toTemplateRecord(r) : null;
}

/** A scene's props by `seq`. */
export function sceneProps(read: SceneRead, sceneId: string): ScenePropRecord[] {
  return read
    .select()
    .from(prop)
    .where(eq(prop.sceneId, sceneId))
    .orderBy(asc(prop.seq))
    .all()
    .map(toPropRecord);
}

/** A scene's kept templates by `seq`. */
export function sceneTemplates(read: SceneRead, sceneId: string): AoeTemplateRecord[] {
  return read
    .select()
    .from(aoeTemplate)
    .where(eq(aoeTemplate.sceneId, sceneId))
    .orderBy(asc(aoeTemplate.seq))
    .all()
    .map(toTemplateRecord);
}

// ---------- a campaign (snapshot providers; the registry cuts the DM window) ----------

export function campaignStructures(read: SceneRead, campaignId: string): SceneStructureRecord[] {
  return read
    .select()
    .from(sceneStructure)
    .where(eq(sceneStructure.campaignId, campaignId))
    .orderBy(asc(sceneStructure.sceneId))
    .all()
    .map(toStructureRecord);
}

export function campaignProps(read: SceneRead, campaignId: string): ScenePropRecord[] {
  return read
    .select()
    .from(prop)
    .where(eq(prop.campaignId, campaignId))
    .orderBy(asc(prop.seq))
    .all()
    .map(toPropRecord);
}

export function campaignTemplates(read: SceneRead, campaignId: string): AoeTemplateRecord[] {
  return read
    .select()
    .from(aoeTemplate)
    .where(eq(aoeTemplate.campaignId, campaignId))
    .orderBy(asc(aoeTemplate.seq))
    .all()
    .map(toTemplateRecord);
}

/** The campaign's `map-settings` record, or null (no row = defaults). */
export function readSettings(read: SceneRead, campaignId: string): MapSettingsRecord | null {
  const r = read.select().from(mapSettings).where(eq(mapSettings.campaignId, campaignId)).get();
  return r ? toSettingsRecord(r) : null;
}

/** FR-SCN-29/30: the campaign's diagonal rule (no row = `5-10-5`); combat reads it server-side. */
export function diagonalRuleOf(read: SceneRead, campaignId: string): DiagonalRule {
  return readSettings(read, campaignId)?.diagonalRule ?? DEFAULT_DIAGONAL_RULE;
}
