// Token-mirror rows. Leaf module: fog's scene re-derive reads these, so it imports nothing from
// fog or the scenes-map registries.
import type { TokenMirrorRecord } from "@shared/token-mirrors/schemas";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { tokenMirror } from "../../db/schema";
import { isAnimatedAsset } from "../assets-pipeline/animated";

type Read = Pick<Db, "select">;
type Row = typeof tokenMirror.$inferSelect;

export function toMirrorRecord(r: Row): TokenMirrorRecord {
  const { createdAt: _c, updatedAt: _u, ...rest } = r;
  // FR-ANIM-06: derived from the copied art; on the wire only when true.
  return isAnimatedAsset(rest.imageAssetId) ? { ...rest, imageAnimated: true } : rest;
}

export function readMirror(read: Read, id: string): TokenMirrorRecord | null {
  const r = read.select().from(tokenMirror).where(eq(tokenMirror.id, id)).get();
  return r ? toMirrorRecord(r) : null;
}

const listed = (read: Read, where: ReturnType<typeof eq>): TokenMirrorRecord[] =>
  read
    .select()
    .from(tokenMirror)
    .where(where)
    .orderBy(asc(tokenMirror.seq))
    .all()
    .map(toMirrorRecord);

export const sceneMirrors = (read: Read, sceneId: string) =>
  listed(read, eq(tokenMirror.sceneId, sceneId));

export const mirrorsOfToken = (read: Read, tokenId: string) =>
  listed(read, eq(tokenMirror.tokenId, tokenId));

export const campaignMirrors = (read: Read, campaignId: string) =>
  listed(read, eq(tokenMirror.campaignId, campaignId));
