import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { RECAP_SHARE_INTENT, type RecapShareInput } from "@shared/session-recap/schemas";

/** RC1–RC3: the note the walkthrough and e2e look for. */
export const RECAP_SHARE_NOTE = "Cleared the Bandit Camp; the map points north.";
/**
 * The fixture session's key: every fixture fact shares the load clock (FR-FIX-08 / -29), so the
 * campaign has one session and it starts at the first log entry.
 */
export const FIXTURE_SESSION_FROM_N = 1;

/**
 * RECAP §13 `recap-share-note` (`sp-s9-shared` only): `recap.share` of the fixture session with
 * the note above and `omit: ["rolls"]`: one `session-recap` notification (audience all). Players'
 * recaps then show the note and no Notable rolls; the DM's mark Notable rolls "Hidden from
 * players" (FR-RECAP-22).
 */
export default defineFixture({
  key: "recap-share-note",
  kind: "setup",
  requires: ["recap-loot-haul"],
  ownerSpec: "session-recap",
  steps: [
    {
      command: RECAP_SHARE_INTENT,
      input: {
        fromN: FIXTURE_SESSION_FROM_N,
        note: RECAP_SHARE_NOTE,
        omit: ["rolls"],
      } satisfies RecapShareInput,
    },
  ],
});
