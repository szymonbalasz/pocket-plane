// Domain events of linked-notes (NOTES §9, ADR-0078). None is logged (FR-NOTES-24): notes add
// nothing to the event log. Payloads name notes by ID only; clients get the `note` record changes.
import { z } from "zod";
import { defineEvent } from "../events/types";

export const NOTE_CHANGES = ["created", "renamed", "deleted", "restored"] as const;

/**
 * `notes.create` / `rename` / `delete` / `restore`: changes = the `note` record (before null on a
 * create). Registered by the feature (`r.event`), not in the shared event list.
 */
export const NoteChanged = defineEvent({
  type: "NoteChanged",
  payload: z.strictObject({
    noteId: z.string().min(1).max(64),
    change: z.enum(NOTE_CHANGES),
  }),
  logged: false,
  undoable: false,
});

const NoteUpdateJson = z.strictObject({
  clientId: z.string().min(1).max(64),
  changes: z.array(z.unknown()),
});

/**
 * `notes.push` accepted (ADR-0078, N2): the updates starting at version `from`, all from editor
 * `clientId`. Changes: none, or the `note` upsert when `updatedAt` moved (at most once a minute).
 * A listener sends `notes.updates` to the note's open editors, the sender included.
 */
export const NoteEdited = defineEvent({
  type: "NoteEdited",
  payload: z.strictObject({
    noteId: z.string().min(1).max(64),
    from: z.int().min(0),
    clientId: z.string().min(1).max(64),
    updates: z.array(NoteUpdateJson),
  }),
  logged: false,
  undoable: false,
});

/**
 * Who has these notes open changed (open, close, or pruning a gone connection; FR-NOTES-16).
 * No changes; a listener sends `notes.here` to each note's open editors.
 */
export const NotesHereChanged = defineEvent({
  type: "NotesHereChanged",
  payload: z.strictObject({ noteIds: z.array(z.string().min(1).max(64)) }),
  logged: false,
  undoable: false,
});
