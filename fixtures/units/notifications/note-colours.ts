import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { noteResolve, noteTestSend } from "@server/features/notifications/commands";

const KEY = "note-colours";
const p1 = (r: { id(k: string, t: string): string }) => r.id("player-1", "player");
const p2 = (r: { id(k: string, t: string): string }) => r.id("player-2", "player");

/**
 * NOTE §13 / CAMP §13 K7, K12 (sprint 5 K4): rows striped in their causer's colour. Test mode
 * only (`note.testSend`). Record index: 0 `player-1`'s pending card (to themself, the DM acts:
 * like a damage card; jade stripe); 1 the DM's info to Player 2 (amber); 2 the DM's "Ready to
 * cross?" to Player 1, resolved by Player 1 (amber stripe, "Resolved by Player 1" in jade).
 */
export default defineFixture({
  key: KEY,
  kind: "setup",
  requires: ["campaign", "player-1", "player-2"],
  ownerSpec: "notifications",
  steps: [
    step(
      noteTestSend,
      { text: "Mira's card: apply 6 damage?", actionLabel: "Apply" },
      { as: "player-1" },
    ),
    step(noteTestSend, (r) => ({
      text: "The bridge creaks",
      audience: "player" as const,
      audiencePlayerId: p2(r),
    })),
    step(noteTestSend, (r) => ({
      text: "Ready to cross?",
      audience: "player" as const,
      audiencePlayerId: p1(r),
      actionLabel: "Ready",
      actionRole: "player" as const,
      actionPlayerId: p1(r),
    })),
    step(noteResolve, (r) => ({ id: r.id(KEY, "notification", 2) }), { as: "player-1" }),
  ],
});
