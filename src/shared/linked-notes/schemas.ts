// Linked notes (NOTES §6, §8, §9): record `note`, the N1 intents (create / rename / delete /
// restore), limits and refusal texts. Every note is shared with the whole table of its campaign
// (FR-NOTES-01): there is no visibility input. Bodies never travel in the record (§8.2).
import { z } from "zod";
import { isNoteTitle, NOTE_TITLE_MAX } from "./titles";

export const NOTE_TYPE = "note";
/** FR-NOTES-23: a roll from a note's die button is labelled this, never the note's title. */
export const NOTE_ROLL_LABEL = "Note";

/** FR-NOTES-03: live notes per campaign. */
export const NOTE_LIVE_MAX = 1_000;
/** FR-NOTES-06: notes in a campaign's Recycle bin. */
export const NOTE_BIN_MAX = 1_000;
/** FR-NOTES-03: body size in UTF-8 bytes (32 KiB, ~5,000 words). */
export const NOTE_BODY_MAX_BYTES = 32 * 1024;

export const NOTE_NOT_FOUND = "Note not found";
/** FR-NOTES-02. */
export const NOTE_TITLE_CLASH = "A note with that title exists";
/** FR-NOTES-03, -05 (the spec gives no wording; picked to match the other caps). */
export const NOTE_LIMIT_MESSAGE = "Note limit reached (1,000 notes)";
/** FR-NOTES-06, the spec's wording. */
export const NOTE_BIN_FULL = "The Recycle bin is full (1,000 notes). Restore some first.";
/** FR-NOTES-03. */
export const NOTE_BODY_TOO_BIG = "Note is full";

const Id = z.string().min(1).max(64);

/**
 * FR-NOTES-02: trimmed, 1–100 characters (code points), no `[[`, `]]`, `|` or line break. Folded
 * uniqueness is the commands' check.
 */
export const NoteTitle = z
  .string()
  .trim()
  .refine(isNoteTitle, {
    message: `Title: 1–${NOTE_TITLE_MAX} characters, no [[, ]], | or line break`,
  });

/** Who did something to a note: the DM (`playerId` null) or a player. */
export const NoteActor = z.strictObject({
  role: z.enum(["dm", "player"]),
  playerId: z.string().nullable(),
});
export type NoteActor = z.infer<typeof NoteActor>;

/** Record `note` (§8.2): campaign scope, lazy `"all"`, the same for the DM and every player. */
export const NoteRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  title: z.string(),
  createdBy: NoteActor,
  updatedAt: z.string(),
  updatedBy: NoteActor,
  /** Set = in the Recycle bin (FR-NOTES-04). */
  deletedAt: z.string().nullable(),
  deletedBy: NoteActor.nullable(),
});
export type NoteRecord = z.infer<typeof NoteRecord>;

/** `notes.create` (FR-NOTES-02, -03, -10): `ifMissing` answers with the live note of that title. */
export const CreateNoteIntent = z.strictObject({
  title: NoteTitle,
  ifMissing: z.boolean().optional(),
});
export interface CreateNoteResult {
  noteId: string;
  /** False when `ifMissing` found a live note with that folded title. */
  created: boolean;
}

/** `notes.rename` (FR-NOTES-02; the link rewrite, FR-NOTES-11, comes with N6). */
export const RenameNoteIntent = z.strictObject({ noteId: Id, title: NoteTitle });

/** `notes.delete` (FR-NOTES-04, -06). */
export const DeleteNoteIntent = z.strictObject({ noteId: Id });

/** `notes.restore` (FR-NOTES-05). */
export const RestoreNoteIntent = z.strictObject({ noteId: Id });
export interface RestoreNoteResult {
  /** The title it came back with ("… (restored)" on a clash). */
  title: string;
}
