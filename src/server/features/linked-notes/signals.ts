// linked-notes signals (ADR-0078, slice N2). Server signals go only to a note's open editors, by
// connection (`hub.sendServerSignal`, ADR-0071): `notes.updates` after an accepted push,
// `notes.here` after open / close / pruning, `notes.closed` when a note is binned while open.
// The client signal `notes.cursor` reaches the players with the note open and the DM's
// connections (ADR-0033 audience); another campaign's note, or a binned one, is `not_found`.
import {
  NOTES_CLOSED_SIGNAL,
  NOTES_CURSOR_SIGNAL,
  NOTES_HERE_SIGNAL,
  NOTES_UPDATES_SIGNAL,
  NoteClosedSignal,
  NoteCursorSignal,
  NoteHereSignal,
  NoteUpdatesSignal,
} from "@shared/linked-notes/collab";
import { NoteChanged, NoteEdited, NotesHereChanged } from "@shared/linked-notes/events";
import { NOTE_NOT_FOUND } from "@shared/linked-notes/schemas";
import type { SignalFrom } from "@shared/protocol/frames";
import type { CommitHook } from "../../commands/commands";
import { notFound } from "../../commands/errors";
import type { Listener } from "../../events/bus";
import type { Actor } from "../../events/types";
import type { Services } from "../../services";
import { defineServerSignal, defineSignal } from "../../ws/signals";
import type { NotesRuntime } from "./collab";
import { getNoteRow } from "./rows";

export const noteUpdatesSignal = defineServerSignal({
  name: NOTES_UPDATES_SIGNAL,
  schema: NoteUpdatesSignal,
});
export const noteHereSignal = defineServerSignal({
  name: NOTES_HERE_SIGNAL,
  schema: NoteHereSignal,
});
export const noteClosedSignal = defineServerSignal({
  name: NOTES_CLOSED_SIGNAL,
  schema: NoteClosedSignal,
});

/** FR-NOTES-15: `{players: <players with the note open>}`; DM connections always (FR-SYNC-28). */
export function noteCursorSignal(rt: NotesRuntime) {
  return defineSignal({
    name: NOTES_CURSOR_SIGNAL,
    schema: NoteCursorSignal,
    roles: ["dm", "player"],
    audience(data, sender, read) {
      const row = getNoteRow(read.db, sender.campaignId, data.noteId);
      if (!row || row.deletedAt !== null) throw notFound(NOTE_NOT_FOUND);
      const subs = rt.sessions.get(data.noteId)?.subs.values() ?? [];
      const players = new Set<string>();
      for (const s of subs) if (s.playerId !== null) players.add(s.playerId);
      return { players: [...players] };
    },
  });
}

const fromOf = (actor: Actor): SignalFrom =>
  actor.role === "player" ? { role: "player", playerId: actor.playerId ?? "" } : { role: "dm" };

/** Sends `payload` to the connections with `noteId` open (a snapshot of them, taken now). */
function toEditors(
  s: Services,
  campaignId: string,
  connIds: ReadonlySet<string>,
  name: string,
  from: SignalFrom,
  payload: unknown,
): void {
  if (connIds.size === 0) return;
  s.hub?.sendServerSignal(campaignId, name, from, (v) => (connIds.has(v.connId) ? payload : null));
}

/** CON-23: an accepted push's text becomes the session's, before any listener runs. */
export function editedCommitHook(rt: NotesRuntime): CommitHook {
  return ({ event }) => {
    if (event.type !== NoteEdited.type) return;
    const p = NoteEdited.payload.parse(event.payload);
    const done = rt.pending.get(p.noteId);
    rt.pending.delete(p.noteId);
    const session = rt.sessions.get(p.noteId);
    if (!done || !session || done.version !== p.from + p.updates.length) return;
    session.text = done.text;
    session.version = done.version;
  };
}

/** `notes.updates` (sender included), `notes.here`, and `notes.closed` + dropping a binned note. */
export function notesListener(s: Services, rt: NotesRuntime): Listener {
  return ({ event, meta }) => {
    const cid = event.campaignId;
    if (cid === null) return;
    if (event.type === NoteEdited.type) {
      const p = NoteEdited.payload.parse(event.payload);
      const session = rt.sessions.get(p.noteId);
      if (!session) return;
      toEditors(s, cid, new Set(session.subs.keys()), NOTES_UPDATES_SIGNAL, fromOf(meta.actor), {
        noteId: p.noteId,
        from: p.from,
        updates: p.updates,
      });
    } else if (event.type === NotesHereChanged.type) {
      for (const noteId of NotesHereChanged.payload.parse(event.payload).noteIds) {
        const session = rt.sessions.get(noteId);
        if (!session) continue;
        toEditors(s, cid, new Set(session.subs.keys()), NOTES_HERE_SIGNAL, fromOf(meta.actor), {
          noteId,
          here: rt.here(noteId),
        });
      }
    } else if (event.type === NoteChanged.type) {
      const p = NoteChanged.payload.parse(event.payload);
      if (p.change !== "deleted") return;
      const session = rt.sessions.get(p.noteId);
      rt.sessions.delete(p.noteId);
      if (!session) return;
      toEditors(s, cid, new Set(session.subs.keys()), NOTES_CLOSED_SIGNAL, fromOf(meta.actor), {
        noteId: p.noteId,
        reason: "deleted",
      });
    }
  };
}
