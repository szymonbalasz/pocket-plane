import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { noteDismiss, noteResolve, noteTestSend } from "@server/features/notifications/commands";

const KEY = "notifications-test";
const p1 = (r: { id(k: string, t: string): string }) => r.id("player-1", "player");
/** The n-th notification this fixture created (0-based, creation order). */
const nth = (n: number) => (r: { id(k: string, t: string, i?: number): string }) =>
  r.id(KEY, "notification", n);

/**
 * NOTE §13: seven test notifications, DM steps only. Test mode only (`note.testSend`).
 * Order (record index): info-all, info-dm, info-p1, pending-dm, pending-p1, resolved-all,
 * dismissed-dm. `SECRET-NOTE` marks DM-only text for leak scans.
 */
export default defineFixture({
  key: KEY,
  kind: "setup",
  requires: ["campaign", "player-1", "player-2"],
  ownerSpec: "notifications",
  steps: [
    step(noteTestSend, { text: "The party reaches the gate", audience: "all" }),
    step(noteTestSend, { text: "SECRET-NOTE goblins wait", audience: "dm" }),
    step(noteTestSend, (r) => ({
      text: "You hear whispers",
      audience: "player" as const,
      audiencePlayerId: p1(r),
    })),
    step(noteTestSend, {
      text: "SECRET-NOTE apply 6 damage?",
      audience: "dm",
      actionLabel: "Apply",
    }),
    step(noteTestSend, (r) => ({
      text: "Roll a CON save, DC 12",
      audience: "player" as const,
      audiencePlayerId: p1(r),
      actionLabel: "Done",
      actionRole: "player" as const,
      actionPlayerId: p1(r),
    })),
    step(noteTestSend, { text: "Torches lit", audience: "all", actionLabel: "Ack" }),
    step(noteResolve, (r) => ({ id: nth(5)(r) })),
    step(noteTestSend, { text: "SECRET-NOTE stale card", audience: "dm", actionLabel: "Apply" }),
    step(noteDismiss, (r) => ({ id: nth(6)(r) })),
  ],
});

/** Record index of each item (manifest `records["notifications-test"].notification`). */
export const NOTIFICATIONS_TEST_ITEMS = [
  "info-all",
  "info-dm",
  "info-p1",
  "pending-dm",
  "pending-p1",
  "resolved-all",
  "dismissed-dm",
] as const;
