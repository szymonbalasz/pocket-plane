import { activateCampaign } from "@server/features/campaign-management/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { createNote, seedNoteBody } from "@server/features/linked-notes/commands";
import { NOTE_TYPE } from "@shared/linked-notes/schemas";

/** The canary the campaign isolation tests look for (NOTES build §1.2). */
export const NOTES_SECOND = { title: "Burnt Ledger", body: "CANARY-OTHER" } as const;

/**
 * NOTES build §1.1 `notes-second-campaign`: in the Second Campaign a "Burnt Ledger" (same title
 * as the main campaign's) with body `CANARY-OTHER`; then the Fixture Campaign is active again.
 */
export default defineFixture({
  key: "notes-second-campaign",
  kind: "setup",
  requires: ["campaign-second"],
  ownerSpec: "linked-notes",
  steps: [
    step(activateCampaign, (r) => ({ id: r.id("campaign-second", "campaign") })),
    step(createNote, { title: NOTES_SECOND.title }),
    step(seedNoteBody, (r) => ({
      noteId: r.id("notes-second-campaign", NOTE_TYPE),
      body: NOTES_SECOND.body,
    })),
    step(activateCampaign, (r) => ({ id: r.id("campaign", "campaign") })),
  ],
});
