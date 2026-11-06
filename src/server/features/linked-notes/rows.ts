// Row reads and the wire record of `note` (NOTES §8). Bodies never leave through here (§8.2).
import type { NoteActor, NoteRecord } from "@shared/linked-notes/schemas";
import { and, asc, count, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { note } from "../../db/schema";

export type NoteRow = typeof note.$inferSelect;
type Reader = Db | Tx;

const actor = (role: "dm" | "player", playerId: string | null): NoteActor => ({
  role,
  playerId: role === "dm" ? null : playerId,
});

/** §8.2: `{id, campaignId, title, category, createdBy, updatedAt, updatedBy, deletedAt, deletedBy}`. */
export function toNoteRecord(r: NoteRow): NoteRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    title: r.title,
    category: r.category,
    createdBy: actor(r.createdByRole, r.createdByPlayerId),
    updatedAt: r.updatedAt,
    updatedBy: actor(r.updatedByRole, r.updatedByPlayerId),
    deletedAt: r.deletedAt,
    deletedBy:
      r.deletedAt === null || r.deletedByRole === null
        ? null
        : actor(r.deletedByRole, r.deletedByPlayerId),
  };
}

/** The note `id` of campaign `cid` (live or binned), else undefined. */
export function getNoteRow(db: Reader, cid: string, id: string): NoteRow | undefined {
  return db
    .select()
    .from(note)
    .where(and(eq(note.id, id), eq(note.campaignId, cid)))
    .get();
}

/** Every note of a campaign, binned included (the `note` load), oldest first. */
export function listNotes(db: Reader, cid: string): NoteRow[] {
  return db
    .select()
    .from(note)
    .where(eq(note.campaignId, cid))
    .orderBy(asc(note.createdAt), asc(note.id))
    .all();
}

/** FR-NOTES-03 / -06: live (`binned` false) or binned notes of a campaign. */
export function noteCount(db: Reader, cid: string, binned: boolean): number {
  const row = db
    .select({ n: count() })
    .from(note)
    .where(
      and(eq(note.campaignId, cid), binned ? isNotNull(note.deletedAt) : isNull(note.deletedAt)),
    )
    .get();
  return row?.n ?? 0;
}

/** FR-NOTES-02: the live note of campaign `cid` with folded title `fold` (other than `exceptId`). */
export function liveNoteByFold(
  db: Reader,
  cid: string,
  fold: string,
  exceptId?: string,
): NoteRow | undefined {
  return db
    .select()
    .from(note)
    .where(
      and(
        eq(note.campaignId, cid),
        eq(note.titleFold, fold),
        isNull(note.deletedAt),
        ...(exceptId === undefined ? [] : [ne(note.id, exceptId)]),
      ),
    )
    .get();
}
