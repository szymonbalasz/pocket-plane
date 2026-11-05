// linked-notes (NOTES): record type `note` (lazy, ADR-0045), the event `NoteChanged` (not logged)
// and the N1 intents create / rename / delete / restore. Co-writing (open / push / close, signals)
// comes with N2 (ADR-0078). `notes.seedBody` is a command for fixtures, not an intent.
import { NoteChanged } from "@shared/linked-notes/events";
import type { Feature } from "../../services";
import { createNote, deleteNote, renameNote, restoreNote, seedNoteBody } from "./commands";
import { noteType } from "./records";

export const linkedNotes: Feature = {
  name: "linked-notes",
  register(r) {
    r.event(NoteChanged);
    r.command(createNote, { intent: true });
    r.command(renameNote, { intent: true });
    r.command(deleteNote, { intent: true });
    r.command(restoreNote, { intent: true });
    r.command(seedNoteBody);
    r.recordType(noteType);
  },
};
