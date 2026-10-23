// Stronghold rows → records (HOLD §8) and the derived `stronghold-index` rows (FR-HOLD-01: built
// from the table, never stored). Nothing here writes.
import {
  indexOf,
  type StrongholdIndexRecord,
  type StrongholdRecord,
} from "@shared/strongholds/schemas";
import { and, asc, count, eq } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { stronghold } from "../../db/schema";

type Reader = Pick<Db | Tx, "select">;
type Row = typeof stronghold.$inferSelect;

export function toStrongholdRecord(r: Row): StrongholdRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    seq: r.seq,
    name: r.name,
    dmOnly: r.dmOnly,
    defenders: r.defenders,
    defendersDmOnly: r.defendersDmOnly,
    notes: r.notes,
    notesDmOnly: r.notesDmOnly,
    facilities: r.facilities,
    staff: r.staff,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function getStronghold(db: Reader, campaignId: string, id: string): StrongholdRecord | null {
  const row = db
    .select()
    .from(stronghold)
    .where(and(eq(stronghold.id, id), eq(stronghold.campaignId, campaignId)))
    .get();
  return row ? toStrongholdRecord(row) : null;
}

/** Every stronghold of the campaign, `seq` order (the lazy provider; FR-HOLD-01). */
export function listStrongholds(db: Reader, campaignId: string): StrongholdRecord[] {
  return db
    .select()
    .from(stronghold)
    .where(eq(stronghold.campaignId, campaignId))
    .orderBy(asc(stronghold.seq))
    .all()
    .map(toStrongholdRecord);
}

/** FR-HOLD-01: the index rows, `seq` order (≤ 8). */
export function listIndex(db: Reader, campaignId: string): StrongholdIndexRecord[] {
  return db
    .select({
      id: stronghold.id,
      campaignId: stronghold.campaignId,
      name: stronghold.name,
      dmOnly: stronghold.dmOnly,
    })
    .from(stronghold)
    .where(eq(stronghold.campaignId, campaignId))
    .orderBy(asc(stronghold.seq))
    .all()
    .map(indexOf);
}

export function strongholdCount(db: Reader, campaignId: string): number {
  return (
    db.select({ n: count() }).from(stronghold).where(eq(stronghold.campaignId, campaignId)).get()
      ?.n ?? 0
  );
}
