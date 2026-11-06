import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { createNote, seedNoteBody } from "@server/features/linked-notes/commands";
import { NOTE_TYPE } from "@shared/linked-notes/schemas";

/** NOTES build §1.1 `notes-shared`: titles and bodies (tests hard-code them). */
export const NOTES_SHARED = {
  ledger: "Burnt Ledger",
  quest: "Quest log",
  duke: "Duke Varen",
  ledgerBody: "Found in [[Duke Varen]]'s office.\nRoll 2d6 to search it.\nSee [[Quest log]].",
  questBody: "# Quest log\n- Recover the [[Burnt Ledger]]",
  dukeBody: "Keeps [[Burnt Ledger|the ledger]] close.",
} as const;

const id = (i: number) => (r: { id(k: string, t: string, i?: number): string }) =>
  r.id("notes-shared", NOTE_TYPE, i);

/**
 * "Burnt Ledger" (Item) by `player-1` (links Duke Varen and Quest log, has `2d6`); "Quest log"
 * (Quest) by the DM (links Burnt Ledger); "Duke Varen" (NPC) by `player-2` (links
 * `[[Burnt Ledger|the ledger]]`). Categories per #454.
 */
export default defineFixture({
  key: "notes-shared",
  kind: "setup",
  requires: ["player-1", "player-2"],
  ownerSpec: "linked-notes",
  steps: [
    step(createNote, { title: NOTES_SHARED.ledger, category: "item" }, { as: "player-1" }),
    step(createNote, { title: NOTES_SHARED.quest, category: "quest" }),
    step(createNote, { title: NOTES_SHARED.duke, category: "npc" }, { as: "player-2" }),
    step(seedNoteBody, (r) => ({ noteId: id(0)(r), body: NOTES_SHARED.ledgerBody }), {
      as: "player-1",
    }),
    step(seedNoteBody, (r) => ({ noteId: id(1)(r), body: NOTES_SHARED.questBody })),
    step(seedNoteBody, (r) => ({ noteId: id(2)(r), body: NOTES_SHARED.dukeBody }), {
      as: "player-2",
    }),
  ],
});
