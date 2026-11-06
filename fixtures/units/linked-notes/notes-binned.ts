import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { createNote, deleteNote, seedNoteBody } from "@server/features/linked-notes/commands";
import { NOTE_TYPE } from "@shared/linked-notes/schemas";

/** NOTES build §1.1 `notes-binned` (tests hard-code these). */
export const NOTES_BINNED = {
  title: "Old rumours",
  body: "Rumour: the Duke owes money",
} as const;

/** "Old rumours" by `player-2`, deleted by the DM: in the Recycle bin with its body. */
export default defineFixture({
  key: "notes-binned",
  kind: "setup",
  requires: ["player-2"],
  ownerSpec: "linked-notes",
  steps: [
    step(createNote, { title: NOTES_BINNED.title, category: "other" }, { as: "player-2" }),
    step(
      seedNoteBody,
      (r) => ({ noteId: r.id("notes-binned", NOTE_TYPE), body: NOTES_BINNED.body }),
      { as: "player-2" },
    ),
    step(deleteNote, (r) => ({ noteId: r.id("notes-binned", NOTE_TYPE) })),
  ],
});
