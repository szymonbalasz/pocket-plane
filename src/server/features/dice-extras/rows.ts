// Row ↔ record mapping and reads for `dice_look` (DICEX §8).
import type { DiceLookRecord } from "@shared/dice-extras/looks";
import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "../../db/client";
import { diceLook } from "../../db/schema";

type Read = Pick<Tx, "select">;
type LookRow = typeof diceLook.$inferSelect;

export const toLookRecord = (r: LookRow): DiceLookRecord => ({
  id: r.id,
  campaignId: r.campaignId,
  ownerKey: r.ownerKey,
  ownerPlayerId: r.ownerPlayerId,
  style: r.style,
  body: r.body,
  pips: r.pips,
  material: r.material,
  updatedAt: r.updatedAt,
});

/** An owner's stored look, or null (no row = the derived default). */
export function readLook(read: Read, campaignId: string, ownerKey: string): DiceLookRecord | null {
  const r = read
    .select()
    .from(diceLook)
    .where(and(eq(diceLook.campaignId, campaignId), eq(diceLook.ownerKey, ownerKey)))
    .get();
  return r ? toLookRecord(r) : null;
}

/** The campaign's looks (≤ 1 + players), owner order. */
export function listLooks(read: Read, campaignId: string): DiceLookRecord[] {
  return read
    .select()
    .from(diceLook)
    .where(eq(diceLook.campaignId, campaignId))
    .orderBy(asc(diceLook.ownerKey))
    .all()
    .map(toLookRecord);
}
