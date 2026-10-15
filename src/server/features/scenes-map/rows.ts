// Row ↔ record mapping and lookups for scenes-map. Rows and DM records have the same fields.
import type { SceneFolderRecord, SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { and, asc, count, eq } from "drizzle-orm";
import { conflict, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { scene, sceneFolder, token } from "../../db/schema";
import type { Actor } from "../../events/types";

type SceneRow = typeof scene.$inferSelect;
type TokenRow = typeof token.$inferSelect;
type FolderRow = typeof sceneFolder.$inferSelect;

export const toSceneRecord = (r: SceneRow): SceneRecord => ({ ...r });
/** `fogged` rides the wire only when true (FOG §9). */
export const toTokenRecord = ({ fogged, ...r }: TokenRow): TokenRecord =>
  fogged ? { ...r, fogged: true } : r;
export const toFolderRecord = (r: FolderRow): SceneFolderRecord => ({ ...r });

/** Campaign fixed at authentication (CON-21): `actor.campaignId`. */
export function campaignOf(actor: Actor): string {
  if (!actor.campaignId) throw conflict("No active campaign");
  return actor.campaignId;
}

export function findScene(tx: Tx, cid: string, id: string): SceneRecord | null {
  const r = tx
    .select()
    .from(scene)
    .where(and(eq(scene.id, id), eq(scene.campaignId, cid)))
    .get();
  return r ? toSceneRecord(r) : null;
}

/** A scene of the campaign, else `not_found` (other campaigns look unknown). */
export function getScene(tx: Tx, cid: string, id: string): SceneRecord {
  const s = findScene(tx, cid, id);
  if (!s) throw notFound("Scene not found");
  return s;
}

export function getToken(tx: Tx, cid: string, id: string): TokenRecord {
  const r = tx
    .select()
    .from(token)
    .where(and(eq(token.id, id), eq(token.campaignId, cid)))
    .get();
  if (!r) throw notFound("Token not found");
  return toTokenRecord(r);
}

export function getFolder(tx: Tx, cid: string, id: string): SceneFolderRecord {
  const r = tx
    .select()
    .from(sceneFolder)
    .where(and(eq(sceneFolder.id, id), eq(sceneFolder.campaignId, cid)))
    .get();
  if (!r) throw notFound("Folder not found");
  return toFolderRecord(r);
}

export function readScene(tx: Tx, id: string): SceneRecord {
  return toSceneRecord(tx.select().from(scene).where(eq(scene.id, id)).get() as SceneRow);
}

export function readToken(tx: Tx, id: string): TokenRecord {
  return toTokenRecord(tx.select().from(token).where(eq(token.id, id)).get() as TokenRow);
}

export function readFolder(tx: Tx, id: string): SceneFolderRecord {
  return toFolderRecord(
    tx.select().from(sceneFolder).where(eq(sceneFolder.id, id)).get() as FolderRow,
  );
}

/** Tokens of a scene in `seq` order. */
export function sceneTokens(tx: Tx, sceneId: string): TokenRecord[] {
  return tx
    .select()
    .from(token)
    .where(eq(token.sceneId, sceneId))
    .orderBy(asc(token.seq))
    .all()
    .map(toTokenRecord);
}

export function countTokens(tx: Tx, where: { sceneId?: string; campaignId?: string }): number {
  const cond = where.sceneId
    ? eq(token.sceneId, where.sceneId)
    : eq(token.campaignId, where.campaignId ?? "");
  return tx.select({ n: count() }).from(token).where(cond).get()?.n ?? 0;
}

export function activeSceneOf(tx: Tx, cid: string): SceneRecord | null {
  const r = tx
    .select()
    .from(scene)
    .where(and(eq(scene.campaignId, cid), eq(scene.active, true)))
    .get();
  return r ? toSceneRecord(r) : null;
}
