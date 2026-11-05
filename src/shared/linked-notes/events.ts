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
