// Note links on the server (FR-NOTES-07, -12; ADR-0078 "Links"; slice N5): `note_link` keeps one
// row per distinct folded target of a note's text, written in the transaction that changes the
// text (a push, the fixtures' seed). Backlinks = the live notes of the campaign with a row for an
// open note's folded title. Notes written before N5 get their rows at the next server start.
import type { NoteBacklink } from "@shared/linked-notes/collab";
import { linkFolds } from "@shared/linked-notes/links";
import { titleFold } from "@shared/linked-notes/titles";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { Db, Tx } from "../../db/client";
import { note, noteLink } from "../../db/schema";
import type { Logger } from "../../log";
import { loadText } from "./collab";

type Reader = Db | Tx;

/** The note's stored link targets, sorted. */
export function storedFolds(db: Reader, noteId: string): string[] {
  return db
    .select({ fold: noteLink.targetFold })
    .from(noteLink)
    .where(eq(noteLink.noteId, noteId))
    .orderBy(asc(noteLink.targetFold))
    .all()
    .map((r) => r.fold);
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Rewrites the note's rows when its text's targets differ; true when they changed. */
export function syncLinks(tx: Tx, noteId: string, text: string): boolean {
  const next = linkFolds(text);
  if (same(storedFolds(tx, noteId), next)) return false;
  tx.delete(noteLink).where(eq(noteLink.noteId, noteId)).run();
  for (const targetFold of next) tx.insert(noteLink).values({ noteId, targetFold }).run();
  return true;
}

/**
 * FR-NOTES-12: the live notes of `cid` linking to note `noteId`'s title (itself left out), by
 * title. A binned target has none (it isn't open anywhere).
 */
export function backlinksOf(db: Reader, cid: string, noteId: string): NoteBacklink[] {
  const target = db
    .select({ title: note.title, deletedAt: note.deletedAt })
    .from(note)
    .where(and(eq(note.id, noteId), eq(note.campaignId, cid)))
    .get();
  if (!target || target.deletedAt !== null) return [];
  return db
    .selectDistinct({ id: note.id, title: note.title })
    .from(noteLink)
    .innerJoin(note, eq(note.id, noteLink.noteId))
    .where(
      and(
        eq(noteLink.targetFold, titleFold(target.title)),
        eq(note.campaignId, cid),
        isNull(note.deletedAt),
        ne(note.id, noteId),
      ),
    )
    .orderBy(asc(note.title), asc(note.id))
    .all();
}

/** A stable key of a backlinks list (what a subscriber was last sent). */
export const backlinksKey = (list: readonly NoteBacklink[]) =>
  list.map((b) => `${b.id}\u0000${b.title}`).join("\u0001");

/**
 * N5 boot rebuild: every note's rows from its current text (body + kept changes), binned ones
 * too (a restore brings its links back). Notes written before N5 have none; afterwards this finds
 * nothing to change. Returns how many notes changed.
 */
export function rebuildLinks(db: Db, log?: Logger): number {
  let changed = 0;
  db.transaction((tx) => {
    for (const row of tx.select().from(note).all()) {
      if (syncLinks(tx, row.id, loadText(tx, row).toString())) changed++;
    }
  });
  if (changed > 0) log?.info(`notes: link rows rebuilt for ${changed} note(s)`);
  return changed;
}
