// The Recap window on the DM registry (FR-RECAP-10): registered with no launcher, fits at
// 1280×720 and covers no open product window at 1600×900; a share / history / Stats / palette open
// (FR-RECAP-21, FR-STATS-79, FR-RECAP-28); the `session-recap` notification view (FR-RECAP-23).
import { expect, mock, test } from "bun:test";
import type { You } from "@shared/protocol/frames";
import { RECAP_WINDOW_KIND, SESSION_RECAP_KIND } from "@shared/session-recap/schemas";
import {
  openRecapRuns,
  recapDefFacts,
  recapOnDefaults,
} from "@ui/features/session-recap/window-checks";
import { dmNotificationViews } from "../../notification-views";

mock.module("../campaign-management/PlayersPanel", () => ({ PlayersPanel: () => null }));
const { dmWindows } = await import("../../windows");

const YOU: You = { campaignId: "c1", role: "dm", playerId: null };

test("FR-RECAP-10 registered (DM): recap.session 'Recap', 440 × 560 (1280×720: 440 × 412), min 340 × 320, useful 400 × 360, closed, no launcher, the share runtime as companion", () => {
  expect(recapDefFacts(dmWindows)).toEqual({
    title: "Recap",
    default720: { w: 440, h: 412 },
    default900: { w: 440, h: 560 },
    minSize: { w: 340, h: 320 },
    usefulSize: { w: 400, h: 360 },
    defaultOpen: false,
    launcher: null,
    companion: true,
  });
});

test("FR-RECAP-10 fits at 1280×720 and covers no open product window at 1600×900 (DM)", () => {
  const small = recapOnDefaults(dmWindows, { w: 1280, h: 720 });
  expect(small.inside).toBe(true);
  expect(small.size.w >= 340 && small.size.h >= 320).toBe(true);
  expect(recapOnDefaults(dmWindows, { w: 1600, h: 900 })).toMatchObject({
    inside: true,
    covers: [],
  });
});

test("FR-RECAP-10 FR-RECAP-21 opens (DM): a feature open (share, history Open) and a user open (Stats, palette) open, restore or front recap.session on that session", () => {
  for (const by of ["feature", "user"] as const) {
    const calls = [{ kind: RECAP_WINDOW_KIND, by }];
    const view = { fromN: 7 };
    expect(openRecapRuns(dmWindows, YOU, by)).toEqual([
      { before: "closed", calls, state: "open", onTop: true, view },
      { before: "minimised", calls, state: "open", onTop: true, view },
      { before: "open", calls, state: "open", onTop: true, view },
    ]);
  }
});

test("FR-RECAP-23 notification view (DM): session-recap registered, info class, an icon and a renderer (its Open), no action", () => {
  const v = dmNotificationViews.get(SESSION_RECAP_KIND);
  expect(v?.icon).toBeDefined();
  expect(v?.render).toBeDefined();
  expect(v?.onAction).toBeUndefined();
  expect((v as { toastClass?: string } | undefined)?.toastClass).toBe("info");
});
