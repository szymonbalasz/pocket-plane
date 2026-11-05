// Record type `note` (NOTES §8.2, ADR-0045): campaign scope, lazy `"all"`: never in a snapshot,
// loaded with `sync.load {type: "note"}`. Every note, binned included, is `full` for the DM and
// every player of its campaign (FR-NOTES-01); the scope gate keeps other campaigns out.
import { NOTE_TYPE, NoteRecord } from "@shared/linked-notes/schemas";
import { defineRecordType } from "../../ws/records";
import { listNotes, toNoteRecord } from "./rows";

export const noteType = defineRecordType<NoteRecord>({
  type: NOTE_TYPE,
  scope: "campaign",
  lazy: "all",
  schema: NoteRecord,
  idOf: (r) => r.id,
  campaignOf: (r) => r.campaignId,
  visibility: () => "full",
  snapshot: ({ db }, v) => listNotes(db, v.campaignId).map(toNoteRecord),
});
