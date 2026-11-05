// linked-notes co-writing intents (ADR-0078, slice N2): `notes.open` / `push` / `close` for the DM
// and every player, over a live connection only (the editor binding is per connection,
// FR-NOTES-14). Each first prunes gone connections. A push is stored as one `note_change` row in
// its own transaction (FR-NOTES-19); the cached text moves after the commit (CON-23).
import {
  CloseNoteIntent,
  NOTE_EDITOR_IN_USE,
  NOTE_EDITOR_MISMATCH,
  NOTE_NOT_OPEN,
  NOTE_OPEN_LIMIT,
  NOTES_FOLD_EVERY,
  NOTES_OPEN_MAX,
  NOTES_TOUCH_MS,
  type NoteUpdate,
  OpenNoteIntent,
  type OpenNoteResult,
  PushNoteIntent,
  type PushNoteResult,
} from "@shared/linked-notes/collab";
import { NoteEdited, NotesHereChanged } from "@shared/linked-notes/events";
import {
  NOTE_BODY_MAX_BYTES,
  NOTE_BODY_TOO_BIG,
  NOTE_NOT_FOUND,
  NOTE_TYPE,
} from "@shared/linked-notes/schemas";
import { fold } from "@shared/search/match";
import { eq } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict, invalid, notFound } from "../../commands/errors";
import { note, noteChange } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { changesFor, type NotesRuntime, pruneChanges, updatesSince } from "./collab";
import { getNoteRow, type NoteRow, toNoteRecord } from "./rows";

export const NOTES_COLLAB_INTENTS = {
  open: "notes.open",
  push: "notes.push",
  close: "notes.close",
} as const;

const TABLE = ["dm", "player"] as const;

function campaignOf(env: CommandEnv): string {
  if (!env.actor.campaignId) throw conflict("No active campaign");
  return env.actor.campaignId;
}

/** Notes are co-written over a live WS connection only. */
function connOf(env: CommandEnv): string {
  if (!env.originConnId) throw invalid("Notes are edited over a live connection");
  return env.originConnId;
}

/** A live note of the actor's campaign, else `not_found` (missing, other campaign or binned). */
function liveNote(env: CommandEnv, cid: string, id: string): NoteRow {
  const row = getNoteRow(env.tx, cid, id);
  if (!row || row.deletedAt !== null) throw notFound(NOTE_NOT_FOUND);
  return row;
}

const role = (env: CommandEnv): "dm" | "player" => (env.actor.role === "player" ? "player" : "dm");
const playerOf = (env: CommandEnv) => (role(env) === "player" ? env.actor.playerId : null);

/** Prunes the campaign's gone connections; the notes whose editors changed join `here`. */
function prune(rt: NotesRuntime, cid: string, here: Set<string>): void {
  for (const id of rt.prune(cid)) here.add(id);
}

function emitHere(env: CommandEnv, cid: string, here: Set<string>): void {
  if (here.size === 0) return;
  env.emit({
    type: NotesHereChanged.type,
    campaignId: cid,
    payload: { noteIds: [...here].sort() },
    changes: [],
  });
}

/**
 * FR-NOTES-13, -16, -18: subscribes this connection to a live note and binds `clientId`.
 * Re-opening on the same connection rebinds. An editor ID bound to another connection: the same
 * person's (a stale tab after a reconnect) moves here; anyone else's → `invalid`. ≤ 8 notes per
 * connection (`conflict`). Result: the updates since `version` when still kept, else the text.
 */
export function openNote(rt: NotesRuntime) {
  return defineCommand({
    name: NOTES_COLLAB_INTENTS.open,
    input: OpenNoteIntent,
    roles: TABLE,
    execute({ noteId, clientId, version }, env): OpenNoteResult {
      const cid = campaignOf(env);
      const connId = connOf(env);
      const here = new Set<string>();
      prune(rt, cid, here);
      const row = liveNote(env, cid, noteId);
      const session = rt.session(env.tx, row);
      const me = { role: role(env), playerId: playerOf(env) };
      const stale: string[] = [];
      for (const sub of session.subs.values()) {
        if (sub.clientId !== clientId || sub.connId === connId) continue;
        if (sub.role !== me.role || sub.playerId !== me.playerId) throw invalid(NOTE_EDITOR_IN_USE);
        stale.push(sub.connId);
      }
      if (!session.subs.has(connId) && rt.openCount(connId) >= NOTES_OPEN_MAX)
        throw conflict(NOTE_OPEN_LIMIT);
      const since =
        version === undefined ? null : updatesSince(env.tx, noteId, version, session.version);
      for (const c of stale) session.subs.delete(c);
      session.subs.set(connId, { connId, ...me, clientId });
      here.add(noteId);
      emitHere(env, cid, here);
      const who = rt.here(noteId);
      return since === null
        ? { mode: "doc", version: session.version, doc: session.text.toString(), here: who }
        : { mode: "updates", version: session.version, updates: since, here: who };
    },
  });
}

/**
 * FR-NOTES-14, -19, -21: updates from this connection's editor, at the note's current version.
 * Stale → the updates since (`accepted: false`), or `reload` when gone or ahead. Over 32 KiB →
 * `invalid` "Note is full", nothing stored. Accepted → one `note_change` row and `note.version`
 * in this transaction; `updatedAt` at most once a minute; every 100 changes the body folds and
 * the rows are pruned.
 */
export function pushNote(rt: NotesRuntime) {
  return defineCommand({
    name: NOTES_COLLAB_INTENTS.push,
    input: PushNoteIntent,
    roles: TABLE,
    execute({ noteId, version, updates }, env): PushNoteResult {
      const cid = campaignOf(env);
      const connId = connOf(env);
      const here = new Set<string>();
      prune(rt, cid, here);
      emitHere(env, cid, here);
      const row = liveNote(env, cid, noteId);
      const sub = rt.sessions.get(noteId)?.subs.get(connId);
      if (!sub) throw invalid(NOTE_NOT_OPEN);
      if (updates.some((u) => u.clientId !== sub.clientId)) throw invalid(NOTE_EDITOR_MISMATCH);
      const session = rt.session(env.tx, row);
      if (version !== session.version) {
        const since = updatesSince(env.tx, noteId, version, session.version);
        return since === null
          ? { accepted: false, reload: true }
          : { accepted: false, updates: since };
      }
      let text = session.text;
      for (const u of updates) text = changesFor(text, u.changes).apply(text);
      const body = text.toString();
      if (Buffer.byteLength(body, "utf8") > NOTE_BODY_MAX_BYTES) throw invalid(NOTE_BODY_TOO_BIG);

      const now = env.ctx.clock.iso();
      const next = version + updates.length;
      const stored: NoteUpdate[] = updates.map((u) => ({
        clientId: u.clientId,
        changes: u.changes,
      }));
      env.tx
        .insert(noteChange)
        .values({ noteId, version, clientId: sub.clientId, changes: stored, at: now })
        .run();
      const touch =
        // biome-ignore lint/style/noRestrictedGlobals: parses a stored stamp; "now" comes from ctx.clock.
        env.ctx.clock.now() - Date.parse(row.updatedAt) >= NOTES_TOUCH_MS;
      const folds = next - row.bodyVersion >= NOTES_FOLD_EVERY;
      env.tx
        .update(note)
        .set({
          version: next,
          ...(touch
            ? { updatedAt: now, updatedByRole: sub.role, updatedByPlayerId: sub.playerId }
            : {}),
          ...(folds ? { body, bodyFold: fold(body), bodyVersion: next } : {}),
        })
        .where(eq(note.id, noteId))
        .run();
      if (folds) pruneChanges(env.tx, noteId, next);
      const changes: RecordChange[] = [];
      if (touch) {
        const after = getNoteRow(env.tx, cid, noteId) as NoteRow;
        changes.push({
          type: NOTE_TYPE,
          id: noteId,
          before: toNoteRecord(row),
          after: toNoteRecord(after),
        });
      }
      rt.pending.set(noteId, { version: next, text });
      env.emit({
        type: NoteEdited.type,
        campaignId: cid,
        payload: { noteId, from: version, clientId: sub.clientId, updates: stored },
        changes,
      });
      return { accepted: true };
    },
  });
}

/** FR-NOTES-16: unsubscribes this connection; not open → ack, nothing changes. */
export function closeNote(rt: NotesRuntime) {
  return defineCommand({
    name: NOTES_COLLAB_INTENTS.close,
    input: CloseNoteIntent,
    roles: TABLE,
    execute({ noteId }, env): void {
      const cid = campaignOf(env);
      const connId = connOf(env);
      const here = new Set<string>();
      prune(rt, cid, here);
      if (!getNoteRow(env.tx, cid, noteId)) throw notFound(NOTE_NOT_FOUND);
      const session = rt.sessions.get(noteId);
      if (session?.subs.delete(connId)) {
        if (session.subs.size === 0) rt.sessions.delete(noteId);
        else here.add(noteId);
      }
      emitHere(env, cid, here);
    },
  });
}
