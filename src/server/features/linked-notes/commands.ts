// linked-notes commands (NOTES §6, §9): `notes.create` / `rename` / `setCategory` (N8) / `delete` /
// `restore`, for
// the DM and every player (FR-NOTES-01), each checked against the actor's campaign: another
// campaign's note is `not_found`. Not logged (FR-NOTES-24). The rename's link rewrite
// (FR-NOTES-11) is N6's; bodies and `note_change` are N2's. `notes.seedBody` is fixtures-only.
import { NoteChanged } from "@shared/linked-notes/events";
import {
  CreateNoteIntent,
  type CreateNoteResult,
  DeleteNoteIntent,
  NOTE_BIN_FULL,
  NOTE_BIN_MAX,
  NOTE_BODY_MAX_BYTES,
  NOTE_BODY_TOO_BIG,
  NOTE_LIMIT_MESSAGE,
  NOTE_LIVE_MAX,
  NOTE_NOT_FOUND,
  NOTE_TITLE_CLASH,
  NOTE_TYPE,
  type NoteActor,
  RenameNoteIntent,
  RestoreNoteIntent,
  type RestoreNoteResult,
  SetNoteCategoryIntent,
} from "@shared/linked-notes/schemas";
import { restoredTitle, titleFold } from "@shared/linked-notes/titles";
import { fold } from "@shared/search/match";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { note } from "../../db/schema";
import { syncLinks } from "./links";
import { rewriteLinks } from "./rename";
import { getNoteRow, liveNoteByFold, type NoteRow, noteCount, toNoteRecord } from "./rows";

export const NOTES_INTENTS = {
  create: "notes.create",
  rename: "notes.rename",
  setCategory: "notes.setCategory",
  delete: "notes.delete",
  restore: "notes.restore",
} as const;

const TABLE = ["dm", "player"] as const;
type Change = z.infer<typeof NoteChanged.payload>["change"];

function campaignOf(env: CommandEnv): string {
  if (!env.actor.campaignId) throw conflict("No active campaign");
  return env.actor.campaignId;
}

/** The actor as stored on a note: a player, else the DM. */
function byOf(env: CommandEnv): NoteActor {
  return env.actor.role === "player"
    ? { role: "player", playerId: env.actor.playerId }
    : { role: "dm", playerId: null };
}

/** The actor's campaign's note (live or binned), else `not_found` (other campaign included). */
function loadNote(env: CommandEnv, cid: string, id: string): NoteRow {
  const row = getNoteRow(env.tx, cid, id);
  if (!row) throw notFound(NOTE_NOT_FOUND);
  return row;
}

function emitChanged(
  env: CommandEnv,
  cid: string,
  change: Change,
  before: NoteRow | null,
  noteId: string,
): void {
  const after = loadNote(env, cid, noteId);
  env.emit({
    type: NoteChanged.type,
    campaignId: cid,
    payload: { noteId, change },
    changes: [
      {
        type: NOTE_TYPE,
        id: noteId,
        before: before ? toNoteRecord(before) : null,
        after: toNoteRecord(after),
      },
    ],
  });
}

/**
 * FR-NOTES-02, -03, -10, -25: a new empty note of `category`. A live note with the same folded
 * title: `ifMissing` answers with it (`created: false`, no write, its category kept), else
 * `conflict`. At 1,000 live notes → `conflict`.
 */
export const createNote = defineCommand({
  name: NOTES_INTENTS.create,
  input: CreateNoteIntent,
  roles: TABLE,
  execute({ title, category, ifMissing }, env): CreateNoteResult {
    const cid = campaignOf(env);
    const titleKey = titleFold(title);
    const clash = liveNoteByFold(env.tx, cid, titleKey);
    if (clash) {
      if (ifMissing) return { noteId: clash.id, created: false };
      throw conflict(NOTE_TITLE_CLASH);
    }
    if (noteCount(env.tx, cid, false) >= NOTE_LIVE_MAX) throw conflict(NOTE_LIMIT_MESSAGE);
    const id = env.ctx.ids.next();
    const now = env.ctx.clock.iso();
    const by = byOf(env);
    env.tx
      .insert(note)
      .values({
        id,
        campaignId: cid,
        title,
        titleFold: titleKey,
        category,
        createdByRole: by.role,
        createdByPlayerId: by.playerId,
        createdAt: now,
        updatedAt: now,
        updatedByRole: by.role,
        updatedByPlayerId: by.playerId,
        deletedAt: null,
        deletedByRole: null,
        deletedByPlayerId: null,
        body: "",
        bodyFold: "",
        bodyVersion: 0,
        version: 0,
      })
      .run();
    emitChanged(env, cid, "created", null, id);
    return { noteId: id, created: true };
  },
});

/**
 * FR-NOTES-02: a live note's title. The same title → ack, no write. Another live note with the
 * folded title → `conflict` (the note itself may change case). A binned note → `not_found`.
 */
export const renameNote = defineCommand({
  name: NOTES_INTENTS.rename,
  input: RenameNoteIntent,
  roles: TABLE,
  execute({ noteId, title }, env): void {
    const cid = campaignOf(env);
    const before = loadNote(env, cid, noteId);
    if (before.deletedAt !== null) throw notFound(NOTE_NOT_FOUND);
    if (before.title === title) return;
    const titleKey = titleFold(title);
    // A clash refuses before anything is written (FR-NOTES-02, -11).
    if (liveNoteByFold(env.tx, cid, titleKey, noteId)) throw conflict(NOTE_TITLE_CLASH);
    const by = byOf(env);
    env.tx
      .update(note)
      .set({
        title,
        titleFold: titleKey,
        updatedAt: env.ctx.clock.iso(),
        updatedByRole: by.role,
        updatedByPlayerId: by.playerId,
      })
      .where(eq(note.id, noteId))
      .run();
    emitChanged(env, cid, "renamed", before, noteId);
    // FR-NOTES-11 (N6): links follow, in this same transaction. A case-only rename keeps the
    // folded title, so its links still resolve and stay as typed.
    if (titleKey !== before.titleFold) rewriteLinks(env, cid, before.titleFold, title);
  },
});

/**
 * FR-NOTES-25, -30 (N8): a live note's category, for anyone at the table; not logged. The same
 * category → ack, no write. A binned note → `not_found`. Moves "who · when" like a rename.
 */
export const setNoteCategory = defineCommand({
  name: NOTES_INTENTS.setCategory,
  input: SetNoteCategoryIntent,
  roles: TABLE,
  execute({ noteId, category }, env): void {
    const cid = campaignOf(env);
    const before = loadNote(env, cid, noteId);
    if (before.deletedAt !== null) throw notFound(NOTE_NOT_FOUND);
    if (before.category === category) return;
    const by = byOf(env);
    env.tx
      .update(note)
      .set({
        category,
        updatedAt: env.ctx.clock.iso(),
        updatedByRole: by.role,
        updatedByPlayerId: by.playerId,
      })
      .where(eq(note.id, noteId))
      .run();
    emitChanged(env, cid, "categorized", before, noteId);
  },
});

/**
 * FR-NOTES-04, -06: to the Recycle bin (`deletedAt`, `deletedBy`); body and links stay in the DB.
 * Already binned → ack, no write (two deletes at once). 1,000 binned → `conflict`, the spec's text.
 */
export const deleteNote = defineCommand({
  name: NOTES_INTENTS.delete,
  input: DeleteNoteIntent,
  roles: TABLE,
  execute({ noteId }, env): void {
    const cid = campaignOf(env);
    const before = loadNote(env, cid, noteId);
    if (before.deletedAt !== null) return;
    if (noteCount(env.tx, cid, true) >= NOTE_BIN_MAX) throw conflict(NOTE_BIN_FULL);
    const by = byOf(env);
    env.tx
      .update(note)
      .set({
        deletedAt: env.ctx.clock.iso(),
        deletedByRole: by.role,
        deletedByPlayerId: by.playerId,
      })
      .where(eq(note.id, noteId))
      .run();
    emitChanged(env, cid, "deleted", before, noteId);
  },
});

/**
 * FR-NOTES-05, -25: back from the bin with its text and category. A live note holding its folded title → "Title
 * (restored)", "(restored 2)"…, within 100 characters. Live already → ack, no write (two restores
 * at once). 1,000 live notes → `conflict`.
 */
export const restoreNote = defineCommand({
  name: NOTES_INTENTS.restore,
  input: RestoreNoteIntent,
  roles: TABLE,
  execute({ noteId }, env): RestoreNoteResult {
    const cid = campaignOf(env);
    const before = loadNote(env, cid, noteId);
    if (before.deletedAt === null) return { title: before.title };
    if (noteCount(env.tx, cid, false) >= NOTE_LIVE_MAX) throw conflict(NOTE_LIMIT_MESSAGE);
    const title = restoredTitle(
      before.title,
      (key) => liveNoteByFold(env.tx, cid, key, noteId) !== undefined,
    );
    const by = byOf(env);
    env.tx
      .update(note)
      .set({
        title,
        titleFold: titleFold(title),
        updatedAt: env.ctx.clock.iso(),
        updatedByRole: by.role,
        updatedByPlayerId: by.playerId,
        deletedAt: null,
        deletedByRole: null,
        deletedByPlayerId: null,
      })
      .where(eq(note.id, noteId))
      .run();
    emitChanged(env, cid, "restored", before, noteId);
    return { title };
  },
});

/**
 * Fixtures only (never a WS intent): sets a note's text as one folded change (`version` + 1,
 * `bodyVersion` = it, no `note_change` row), so N1's units carry the spec's bodies before
 * co-writing exists. Refused outside a fixture load. No record change: bodies aren't in `note`.
 */
export const seedNoteBody = defineCommand({
  name: "notes.seedBody",
  input: z.strictObject({ noteId: z.string().min(1).max(64), body: z.string() }),
  roles: TABLE,
  execute({ noteId, body }, env): void {
    if (env.ctx.fixtureKey === undefined) throw forbidden("Fixtures only");
    const cid = campaignOf(env);
    const row = loadNote(env, cid, noteId);
    if (Buffer.byteLength(body, "utf8") > NOTE_BODY_MAX_BYTES) throw invalid(NOTE_BODY_TOO_BIG);
    const version = row.version + 1;
    env.tx
      .update(note)
      .set({ body, bodyFold: fold(body), bodyVersion: version, version })
      .where(eq(note.id, noteId))
      .run();
    syncLinks(env.tx, noteId, body);
  },
});
