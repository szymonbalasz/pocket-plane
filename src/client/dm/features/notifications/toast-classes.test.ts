// FR-NOTE-52 (sprint 8, WF4): every line of this client's view list names its toast class, the
// same as its server kind's (`src/server/features/notifications/kinds.ts`).
import { describe, expect, test } from "bun:test";
import { dmNotificationViews } from "../../notification-views";

const EXPECTED: Record<string, string> = {
  test: "info",
  "damage-card": "card",
  "loot-received": "info",
  "cbtx-concentration": "card",
  "charx-draft": "card",
  "cbt-summon-concentration": "card",
  "charx-approved": "info",
  "handout-shared": "info",
  "mod-trigger": "info",
  "stats-awards": "info",
};

describe("FR-NOTE-52 toast classes", () => {
  test("FR-NOTE-52 toast classes (dm): every view names its kind's class", () => {
    for (const [kind, cls] of Object.entries(EXPECTED)) {
      expect([kind, dmNotificationViews.get(kind)?.toastClass]).toEqual([kind, cls]);
    }
  });
});
