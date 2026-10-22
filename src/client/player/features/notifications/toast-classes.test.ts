// FR-NOTE-52 (sprint 8, WF4): every line of this client's view list names its toast class, the
// same as its server kind's (`src/server/features/notifications/kinds.ts`).
import { describe, expect, test } from "bun:test";
import { playerNotificationViews } from "../../notification-views";

const EXPECTED: Record<string, string> = {
  test: "info",
  "damage-card": "card",
  "loot-received": "info",
  "cbtx-concentration": "card",
  "charx-approved": "info",
  "handout-shared": "info",
  "mod-trigger": "info",
  "stats-awards": "info",
};

describe("FR-NOTE-52 toast classes", () => {
  test("FR-NOTE-52 toast classes (player): every view names its kind's class", () => {
    for (const [kind, cls] of Object.entries(EXPECTED)) {
      expect([kind, playerNotificationViews.get(kind)?.toastClass]).toEqual([kind, cls]);
    }
  });
});
