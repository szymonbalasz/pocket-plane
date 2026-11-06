// FR-NOTES-29 (N9): the token menu's note entry, pure. The title a token's note gets (its name
// without `[[`, `]]` and `|`, trimmed; null when nothing valid is left), the category it starts in
// (Player for a character token, NPC for any other) and the live note it opens (folded title).
import type { NoteRecord } from "@shared/linked-notes/schemas";
import { isNoteTitle, titleFold } from "@shared/linked-notes/titles";

/** FR-NOTES-25: the categories a token note starts in. */
export type TokenNoteCategory = "player" | "npc";

const MARKS = /\[\[|\]\]|\|/g;

/** FR-NOTES-29: the note title for a token name, or null (no entry). Repeats until no mark is left. */
export function tokenNoteTitle(name: string): string | null {
  let s = name;
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(MARKS, "");
  }
  s = s.trim();
  return isNoteTitle(s) ? s : null;
}

/** FR-NOTES-29: Player when the token stands for a character (`characterId` set), else NPC. */
export function tokenNoteCategory(t: { characterId: string | null }): TokenNoteCategory {
  return t.characterId ? "player" : "npc";
}

/**
 * N8 adds `category` to `notes.create`; until it lands on this branch the intent refuses the key,
 * so the payload leaves it out. Flip when N8 merges.
 */
export const CREATE_SENDS_CATEGORY = false;

/** FR-NOTES-29: the `notes.create` payload for a token's note (`ifMissing`: one note per name). */
export function tokenNoteCreate(
  t: { characterId: string | null },
  title: string,
): { title: string; ifMissing: true; category?: TokenNoteCategory } {
  return CREATE_SENDS_CATEGORY
    ? { title, ifMissing: true, category: tokenNoteCategory(t) }
    : { title, ifMissing: true };
}

/** FR-NOTES-29: the live note whose folded title is the token note title's, if any. */
export function tokenNoteMatch(
  title: string,
  notes: readonly Pick<NoteRecord, "id" | "title" | "deletedAt">[],
): string | null {
  const key = titleFold(title);
  return notes.find((n) => n.deletedAt === null && titleFold(n.title) === key)?.id ?? null;
}

/**
 * FR-NOTES-29: what choosing the line does. A match opens; else Create, which on a token hidden
 * from players (DM only) asks first: "Players will see this note's title".
 */
export function tokenNoteAction(
  t: { hidden: boolean },
  noteId: string | null,
): "open" | "create" | "confirm" {
  if (noteId) return "open";
  return t.hidden ? "confirm" : "create";
}
