// linked-notes (NOTES): record type `note` (lazy, ADR-0045); the not-logged events `NoteChanged`,
// `NoteEdited`, `NotesHereChanged`; the intents create / rename / delete / restore (N1),
// setCategory (N8) and open / push / close (N2, ADR-0078); the server signals `notes.updates` / `notes.here` /
// `notes.closed` and the client signal `notes.cursor`. `notes.seedBody` is a fixtures command.
import { CampaignActivated } from "@shared/events/campaign-management";
import { NoteChanged, NoteEdited, NotesHereChanged } from "@shared/linked-notes/events";
import type { Feature } from "../../services";
import { NotesRuntime, notesRuntimes } from "./collab";
import { closeNote, openNote, pushNote } from "./collab-commands";
import {
  createNote,
  deleteNote,
  renameNote,
  restoreNote,
  seedNoteBody,
  setNoteCategory,
} from "./commands";
import { rebuildLinks } from "./links";
import { noteType } from "./records";
import { searchCommitHook } from "./search";
import {
  editedCommitHook,
  noteBacklinksSignal,
  noteClosedSignal,
  noteCursorSignal,
  noteHereSignal,
  notesListener,
  noteUpdatesSignal,
} from "./signals";

export const linkedNotes: Feature = {
  name: "linked-notes",
  register(r) {
    const rt = new NotesRuntime(r.services);
    notesRuntimes.set(r.services, rt);
    r.event(NoteChanged);
    r.event(NoteEdited);
    r.event(NotesHereChanged);
    r.command(createNote, { intent: true });
    r.command(renameNote, { intent: true });
    r.command(setNoteCategory, { intent: true });
    r.command(deleteNote, { intent: true });
    r.command(restoreNote, { intent: true });
    r.command(seedNoteBody);
    r.command(openNote(rt), { intent: true });
    r.command(pushNote(rt), { intent: true });
    r.command(closeNote(rt), { intent: true });
    r.recordType(noteType);
    r.services.signals.registerServer(noteUpdatesSignal);
    r.services.signals.registerServer(noteHereSignal);
    r.services.signals.registerServer(noteClosedSignal);
    r.services.signals.registerServer(noteBacklinksSignal);
    // N5: link rows for notes written before links existed (and any drift), at every start.
    r.onStart("linked-notes.links", (s) => {
      rebuildLinks(s.db, s.log);
    });
    r.signal(noteCursorSignal(rt));
    r.afterCommit("linked-notes.edited", editedCommitHook(rt));
    r.afterCommit("linked-notes.search", searchCommitHook(r.services));
    r.listener("linked-notes.signals", notesListener(r.services, rt));
    // A campaign switch closes every connection (4409): drop the other campaigns' sessions.
    r.listener("linked-notes.switch", ({ event }) => {
      if (event.type !== CampaignActivated.type) return;
      rt.dropOtherCampaigns(CampaignActivated.payload.parse(event.payload).campaignId);
    });
  },
};
